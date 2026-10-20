//! D-Bus plumbing (`logind` feature): logind sleep/shutdown/lock signals and the idle time
//! sources used when X11 cannot provide one (Wayland). Blocking `zbus` API, one listener
//! thread; method calls happen on the sampler thread every tick.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};

use adapters_common::fanout::SignalFanout;
use zbus::blocking::{Connection, MessageIterator};
use zbus::message::Type;
use zbus::zvariant::{OwnedObjectPath, OwnedValue};
use zbus::{MatchRule, Message};

use crate::logind::{
    LOGIND_BUS_NAME, MANAGER_INTERFACE, MANAGER_PATH, MUTTER_IDLE_BUS_NAME, MUTTER_IDLE_INTERFACE,
    MUTTER_IDLE_PATH, SESSION_INTERFACE, idle_from_logind, idle_from_mutter, locked_hint_signal,
    manager_signal, session_signal,
};

const PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";
/// Signals buffered while the listener is busy; logind sends very few.
const SIGNAL_QUEUE: usize = 64;

/// Object path of this process' login session: `$XDG_SESSION_ID` when the desktop exports
/// it (apps started from GNOME/KDE run in systemd user scopes, outside any session), else
/// logind's `auto` alias (the caller's session or the user's display session).
fn own_session(system: &Connection) -> zbus::Result<OwnedObjectPath> {
    let id = std::env::var("XDG_SESSION_ID")
        .ok()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| "auto".to_owned());
    system
        .call_method(
            Some(LOGIND_BUS_NAME),
            MANAGER_PATH,
            Some(MANAGER_INTERFACE),
            "GetSession",
            &id.as_str(),
        )?
        .body()
        .deserialize::<OwnedObjectPath>()
}

/// Turns one logind message into an engine signal. Lock signals and `LockedHint` changes of
/// other sessions (other users, other seats) are ignored.
fn signal_of(message: &Message, session: Option<&str>) -> Option<application::ports::SystemSignal> {
    let header = message.header();
    let member = header.member()?.as_str().to_owned();
    let path = header.path().map(|p| p.as_str().to_owned());
    let ours = session.is_some() && path.as_deref() == session;
    match member.as_str() {
        "PrepareForSleep" | "PrepareForShutdown" if path.as_deref() == Some(MANAGER_PATH) => {
            let active = message.body().deserialize::<bool>().ok()?;
            manager_signal(&member, active)
        }
        "Lock" | "Unlock" if ours => session_signal(&member),
        "PropertiesChanged" if ours => {
            let (interface, changed, _invalidated) = message
                .body()
                .deserialize::<(String, HashMap<String, OwnedValue>, Vec<String>)>()
                .ok()?;
            if interface != SESSION_INTERFACE {
                return None;
            }
            bool::try_from(changed.get("LockedHint")?)
                .ok()
                .map(locked_hint_signal)
        }
        _ => None,
    }
}

fn listen(power: &SignalFanout) -> zbus::Result<()> {
    let system = Connection::system()?;
    let session = own_session(&system)
        .map_err(|error| eprintln!("logind session unknown, lock signals disabled: {error}"))
        .ok();
    let session = session.as_ref().map(|p| p.as_str().to_owned());
    let rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender(LOGIND_BUS_NAME)?
        .build();
    for message in MessageIterator::for_match_rule(rule, &system, Some(SIGNAL_QUEUE))? {
        // A malformed message is skipped; a closed bus ends the iterator.
        let Ok(message) = message else { continue };
        if let Some(signal) = signal_of(&message, session.as_deref()) {
            power.send(signal);
        }
    }
    Ok(())
}

/// Starts the logind listener. Without a system bus (containers, minimal systems) it logs
/// once and ends: tracking continues without sleep/lock signals.
pub fn spawn_logind_listener(power: SignalFanout) -> std::io::Result<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("logind".into())
        .spawn(move || {
            if let Err(error) = listen(&power) {
                eprintln!("logind signals unavailable: {error}");
            }
        })
}

/// Idle time for sessions without an X11 counter: GNOME Mutter's `IdleMonitor` (a real
/// input counter) when present, else logind's coarse `IdleHint`.
pub struct DbusIdle {
    session_bus: Option<Connection>,
    system_bus: Option<Connection>,
    login_session: Option<OwnedObjectPath>,
    mutter_available: AtomicBool,
}

impl DbusIdle {
    pub fn connect() -> Self {
        let session_bus = Connection::session().ok();
        let system_bus = Connection::system().ok();
        let login_session = system_bus.as_ref().and_then(|bus| own_session(bus).ok());
        Self {
            mutter_available: AtomicBool::new(session_bus.is_some()),
            session_bus,
            system_bus,
            login_session,
        }
    }

    fn mutter_idle(&self) -> Option<f64> {
        if !self.mutter_available.load(Ordering::Relaxed) {
            return None;
        }
        let bus = self.session_bus.as_ref()?;
        let reply = bus.call_method(
            Some(MUTTER_IDLE_BUS_NAME),
            MUTTER_IDLE_PATH,
            Some(MUTTER_IDLE_INTERFACE),
            "GetIdletime",
            &(),
        );
        match reply.and_then(|message| message.body().deserialize::<u64>()) {
            Ok(ms) => Some(idle_from_mutter(ms)),
            Err(_) => {
                // Not GNOME (or the call is refused): stop asking every tick.
                self.mutter_available.store(false, Ordering::Relaxed);
                None
            }
        }
    }

    fn session_property<T>(&self, name: &str) -> Option<T>
    where
        T: TryFrom<OwnedValue>,
    {
        let bus = self.system_bus.as_ref()?;
        let path = self.login_session.as_ref()?;
        let value = bus
            .call_method(
                Some(LOGIND_BUS_NAME),
                path.as_str(),
                Some(PROPERTIES_INTERFACE),
                "Get",
                &(SESSION_INTERFACE, name),
            )
            .ok()?
            .body()
            .deserialize::<OwnedValue>()
            .ok()?;
        T::try_from(value).ok()
    }

    fn logind_idle(&self) -> Option<f64> {
        let hint: bool = self.session_property("IdleHint")?;
        let since: u64 = self.session_property("IdleSinceHint").unwrap_or(0);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_micros()).unwrap_or(u64::MAX));
        Some(idle_from_logind(hint, since, now))
    }

    pub fn seconds_since_input(&self) -> f64 {
        self.mutter_idle()
            .or_else(|| self.logind_idle())
            .unwrap_or(0.0)
    }
}
