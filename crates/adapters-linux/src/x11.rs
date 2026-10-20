//! X11 access through `x11rb` (pure Rust, no libX11): the EWMH active window, its title and
//! application, the MIT-SCREEN-SAVER idle counter, and a listener thread for switches.
//!
//! Every request can fail (window destroyed between two calls, server gone); failures are
//! answered with `None` / zero idle, never a panic.

use std::path::PathBuf;
use std::thread::JoinHandle;

use adapters_common::activation::Activation;
use crossbeam_channel::Sender;
use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::Event;
use x11rb::protocol::screensaver::{self, ConnectionExt as _};
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ConnectionExt as _, EventMask, GetPropertyReply,
    Window,
};
use x11rb::rust_connection::RustConnection;

use crate::logind::idle_from_x11;
use crate::naming::{decode_title, identity, parse_wm_class, process_name};

/// Longest property read, in 32-bit units (16 KiB): plenty for titles and class names.
const MAX_PROPERTY_UNITS: u32 = 4096;
/// Extension Xwayland advertises (Xwayland 23.1 and later).
const XWAYLAND_EXTENSION: &str = "XWAYLAND";

struct Atoms {
    net_active_window: Atom,
    net_wm_name: Atom,
    net_wm_pid: Atom,
    utf8_string: Atom,
}

impl Atoms {
    fn intern(conn: &RustConnection) -> Result<Self, String> {
        let atom = |name: &[u8]| -> Result<Atom, String> {
            conn.intern_atom(false, name)
                .map_err(|e| e.to_string())?
                .reply()
                .map(|reply| reply.atom)
                .map_err(|e| e.to_string())
        };
        Ok(Self {
            net_active_window: atom(b"_NET_ACTIVE_WINDOW")?,
            net_wm_name: atom(b"_NET_WM_NAME")?,
            net_wm_pid: atom(b"_NET_WM_PID")?,
            utf8_string: atom(b"UTF8_STRING")?,
        })
    }
}

/// One connection to the X server named by `$DISPLAY`.
pub struct X11 {
    conn: RustConnection,
    root: Window,
    atoms: Atoms,
    screensaver: bool,
}

impl X11 {
    /// Connects to `$DISPLAY`. Fails fast (no retry loop) when there is no server.
    pub fn connect() -> Result<Self, String> {
        let (conn, screen) = RustConnection::connect(None).map_err(|e| e.to_string())?;
        let root = conn
            .setup()
            .roots
            .get(screen)
            .map(|s| s.root)
            .ok_or("the X server reported no screen")?;
        let atoms = Atoms::intern(&conn)?;
        let screensaver = conn
            .extension_information(screensaver::X11_EXTENSION_NAME)
            .ok()
            .flatten()
            .is_some();
        Ok(Self {
            conn,
            root,
            atoms,
            screensaver,
        })
    }

    pub fn is_xwayland(&self) -> bool {
        self.conn
            .extension_information(XWAYLAND_EXTENSION)
            .ok()
            .flatten()
            .is_some()
    }

    fn property(&self, window: Window, property: Atom, type_: Atom) -> Option<GetPropertyReply> {
        self.conn
            .get_property(false, window, property, type_, 0, MAX_PROPERTY_UNITS)
            .ok()?
            .reply()
            .ok()
            .filter(|reply| reply.type_ != u32::from(AtomEnum::NONE))
    }

    fn cardinal(&self, window: Window, property: Atom, type_: Atom) -> Option<u32> {
        self.property(window, property, type_)?.value32()?.next()
    }

    /// The focused client window (`_NET_ACTIVE_WINDOW`); `None` when nothing has the focus or
    /// the window manager does not implement EWMH.
    pub fn active_window(&self) -> Option<Window> {
        self.cardinal(
            self.root,
            self.atoms.net_active_window,
            AtomEnum::WINDOW.into(),
        )
        .filter(|&window| window != 0)
    }

    /// Application of the active window.
    pub fn activation(&self) -> Option<Activation> {
        let window = self.active_window()?;
        let wm_class = self
            .property(window, AtomEnum::WM_CLASS.into(), AtomEnum::STRING.into())
            .and_then(|reply| parse_wm_class(&reply.value));
        let pid = self
            .cardinal(window, self.atoms.net_wm_pid, AtomEnum::CARDINAL.into())
            .filter(|&pid| pid != 0);
        let process = pid.and_then(read_process_name);
        let identity = identity(wm_class.as_ref(), process.as_deref())?;
        Some(Activation {
            pid: pid.and_then(|p| i32::try_from(p).ok()).unwrap_or(0),
            identity,
            window: Some(u64::from(window)),
        })
    }

    /// `_NET_WM_NAME`, falling back to `WM_NAME`.
    pub fn title(&self, window: Window) -> Option<String> {
        let net = self.property(window, self.atoms.net_wm_name, self.atoms.utf8_string);
        let legacy = self.property(window, AtomEnum::WM_NAME.into(), AtomEnum::ANY.into());
        let legacy_is_utf8 = legacy
            .as_ref()
            .is_some_and(|reply| reply.type_ == self.atoms.utf8_string);
        decode_title(
            net.as_ref().map(|reply| reply.value.as_slice()),
            legacy.as_ref().map(|reply| reply.value.as_slice()),
            legacy_is_utf8,
        )
    }

    /// Seconds since the last keyboard or pointer input; 0 when the extension is missing.
    pub fn idle_seconds(&self) -> f64 {
        if !self.screensaver {
            return 0.0;
        }
        self.conn
            .screensaver_query_info(self.root)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map_or(0.0, |info| idle_from_x11(info.ms_since_user_input))
    }

    /// Subscribes to property changes on the root window (`_NET_ACTIVE_WINDOW` updates).
    fn watch_root(&self) -> Result<(), String> {
        let attributes = ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE);
        self.conn
            .change_window_attributes(self.root, &attributes)
            .map_err(|e| e.to_string())?
            .check()
            .map_err(|e| e.to_string())?;
        self.conn.flush().map_err(|e| e.to_string())
    }
}

/// Name of a local process; `None` for processes of other users or other hosts.
fn read_process_name(pid: u32) -> Option<String> {
    let exe: Option<PathBuf> = std::fs::read_link(format!("/proc/{pid}/exe")).ok();
    let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok();
    process_name(exe.as_deref(), comm.as_deref())
}

/// Reports active-window switches as they happen, on its own connection. Ends (without
/// retrying) when the server closes the connection, so it never spins.
pub fn spawn_listener(activations: Sender<Activation>) -> std::io::Result<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("x11-events".into())
        .spawn(move || {
            let x11 = match X11::connect() {
                Ok(x11) => x11,
                Err(error) => {
                    eprintln!("X11 event listener unavailable: {error}");
                    return;
                }
            };
            if let Err(error) = x11.watch_root() {
                eprintln!("cannot watch the X11 root window: {error}");
                return;
            }
            loop {
                match x11.conn.wait_for_event() {
                    Ok(Event::PropertyNotify(event))
                        if event.atom == x11.atoms.net_active_window =>
                    {
                        if let Some(activation) = x11.activation() {
                            // Full queue: the sampler is behind and polls anyway.
                            let _ = activations.try_send(activation);
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        eprintln!("X11 connection closed: {error}");
                        return;
                    }
                }
            }
        })
}
