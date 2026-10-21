//! System notifications (design section 11, task 2.8). Authorization is optional (R5.5
//! amended): the notification is only an extra alert for the idle-return card, and when the
//! user has not granted it the popover (opened by the event sink) is the whole experience.
//! Everything is best effort; a failing notification never reaches the engine.

use std::sync::atomic::{AtomicBool, Ordering};

use application::ports::{FocusEndAlert, Notifier};
use domain::{FocusKind, GoalEventKind, IdleGap};
use tauri::{AppHandle, Wry};
use tauri_plugin_notification::{NotificationExt, PermissionState};

/// Where the app stands with the OS notification permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authorization {
    Granted,
    Denied,
    /// Never asked yet.
    Undetermined,
}

/// Seam over the OS notification service; faked in tests.
pub trait Toaster: Send {
    fn authorization(&self) -> Authorization;
    /// Asks the user (the system shows its dialog at most once).
    fn request_authorization(&self) -> Authorization;
    /// `sound` asks for the system alert sound (end of a focus block).
    fn show(&self, title: &str, body: &str, sound: bool) -> Result<(), String>;
}

pub struct SystemNotifier<T: Toaster> {
    toaster: T,
    revocation_sent: AtomicBool,
}

impl<T: Toaster> SystemNotifier<T> {
    pub fn new(toaster: T) -> Self {
        Self {
            toaster,
            revocation_sent: AtomicBool::new(false),
        }
    }

    /// Asks only the first time a notification is actually wanted, in context.
    fn authorized(&self) -> bool {
        match self.toaster.authorization() {
            Authorization::Granted => true,
            Authorization::Denied => false,
            Authorization::Undetermined => {
                self.toaster.request_authorization() == Authorization::Granted
            }
        }
    }

    fn notify(&self, title: &str, body: &str) {
        self.notify_with(title, body, false);
    }

    /// `true` when the notification was shown.
    fn notify_with(&self, title: &str, body: &str, sound: bool) -> bool {
        // Best effort by design: the popover fallback already covers a failure.
        self.authorized() && self.toaster.show(title, body, sound).is_ok()
    }
}

impl<T: Toaster> Notifier for SystemNotifier<T> {
    fn idle_return(&self, gap: &IdleGap) {
        self.notify("Welcome back", &idle_message(gap));
    }

    /// Sent once per run: the engine reports a revocation once per transition, but a flaky
    /// toggle in Settings should not spam the user.
    fn permission_revoked(&self) {
        if !self.revocation_sent.swap(true, Ordering::SeqCst) {
            self.notify(
                "Accessibility access was turned off",
                "Kaiflow keeps recording app names but not window titles. \
                 Open the app to restore access.",
            );
        }
    }

    fn goal_crossed(&self, label: &str, kind: GoalEventKind) {
        let (title, body) = goal_message(label, kind);
        self.notify(&title, &body);
    }

    fn focus_drift(&self, intent: &str, app_name: &str) {
        let (title, body) = focus_drift_message(intent, app_name);
        self.notify(&title, &body);
    }

    fn focus_finished(&self, alert: &FocusEndAlert) -> bool {
        let (title, body) = focus_finished_message(alert);
        self.notify_with(&title, &body, alert.sound)
    }

    fn focus_heads_up(&self, kind: FocusKind, intent: &str, sound: bool) {
        let (title, body) = focus_heads_up_message(kind, intent);
        self.notify_with(&title, &body, sound);
    }
}

/// A gentle nudge, never a reprimand. No sound is requested: the toast is informational and
/// the in-app card and the tray marker carry the same message.
pub fn focus_drift_message(intent: &str, app_name: &str) -> (String, String) {
    let body = if intent.trim().is_empty() {
        format!("You have been in {app_name} for a while.")
    } else {
        format!("You have been in {app_name} for a while. Your focus: {intent}.")
    };
    ("Still on track?".to_owned(), body)
}

/// `25 minutes`, `1 minute`.
fn minutes_text(ms: i64) -> String {
    match (ms.max(0) + 30_000) / 60_000 {
        1 => "1 minute".to_owned(),
        n => format!("{n} minutes"),
    }
}

/// `5-minute`, as in "a 5-minute break".
fn minutes_adjective(ms: i64) -> String {
    format!("{}-minute", (ms.max(0) + 30_000) / 60_000)
}

/// Title and body for a block that ran its course, with what comes next.
pub fn focus_finished_message(alert: &FocusEndAlert) -> (String, String) {
    let title = match alert.kind {
        FocusKind::Focus => "Focus block done",
        FocusKind::Timer => "Time is up",
        FocusKind::Break => "Break is over",
    };
    let task = alert.intent.trim();
    let next = match (alert.next, alert.auto_started) {
        (Some((FocusKind::Break, ms)), true) => {
            format!("Your {} break has started.", minutes_adjective(ms))
        }
        (Some((FocusKind::Break, ms)), false) => {
            format!("Time for a {} break.", minutes_adjective(ms))
        }
        (Some((_, ms)), true) => {
            format!("Your next {} block has started.", minutes_adjective(ms))
        }
        (Some((_, ms)), false) => format!("Ready for another {}?", minutes_text(ms)),
        (None, _) if alert.kind == FocusKind::Break => "Ready when you are.".to_owned(),
        (None, _) => "Nice work.".to_owned(),
    };
    let body = if task.is_empty() || alert.kind == FocusKind::Break {
        next
    } else {
        format!("{task}. {next}")
    };
    (title.to_owned(), body)
}

pub fn focus_heads_up_message(kind: FocusKind, intent: &str) -> (String, String) {
    let body = match (kind, intent.trim()) {
        (FocusKind::Break, _) => "Your break ends in a minute.".to_owned(),
        (_, "") => "Time to wrap up.".to_owned(),
        (_, task) => format!("Time to wrap up: {task}."),
    };
    ("One minute left".to_owned(), body)
}

/// Title and body of a goal alert. Never mentions window titles; a limit alert only informs.
pub fn goal_message(label: &str, kind: GoalEventKind) -> (String, String) {
    match kind {
        GoalEventKind::Reached => (
            "Goal reached".to_owned(),
            format!("You reached your goal: {label}."),
        ),
        GoalEventKind::Exceeded => (
            "Limit passed".to_owned(),
            format!("You went over your limit: {label}."),
        ),
    }
}

/// Forwards idle-return notifications but drops the "Accessibility was turned off" one. Used
/// where a degraded state comes from the session (Linux on Wayland or without a display), not
/// from a revoked permission: the in-app banner explains it, and a revocation notice at every
/// launch would be wrong.
pub struct WithoutRevocationNotice(pub Box<dyn Notifier>);

impl Notifier for WithoutRevocationNotice {
    fn idle_return(&self, gap: &IdleGap) {
        self.0.idle_return(gap);
    }

    fn permission_revoked(&self) {}

    fn goal_crossed(&self, label: &str, kind: GoalEventKind) {
        self.0.goal_crossed(label, kind);
    }

    fn focus_drift(&self, intent: &str, app_name: &str) {
        self.0.focus_drift(intent, app_name);
    }

    fn focus_finished(&self, alert: &FocusEndAlert) -> bool {
        self.0.focus_finished(alert)
    }

    fn focus_heads_up(&self, kind: FocusKind, intent: &str, sound: bool) {
        self.0.focus_heads_up(kind, intent, sound);
    }
}

/// Body of the idle-return notification. Never includes window titles.
pub fn idle_message(gap: &IdleGap) -> String {
    let minutes = (gap.ended_at.0 - gap.started_at.0).max(0) / 60_000;
    let away = match minutes {
        0 => "less than a minute".to_string(),
        1 => "1 minute".to_string(),
        n => format!("{n} minutes"),
    };
    format!("You were away for {away}. Choose what to do with that time.")
}

/// A short, soft system sound (one of the macOS alert sounds; elsewhere the platform default).
#[cfg(target_os = "macos")]
const ALERT_SOUND: &str = "Glass";
#[cfg(not(target_os = "macos"))]
const ALERT_SOUND: &str = "default";

/// Real toaster backed by `tauri-plugin-notification`, used only from Rust.
pub struct TauriToaster {
    app: AppHandle<Wry>,
}

impl TauriToaster {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }
}

fn map_state(state: PermissionState) -> Authorization {
    match state {
        PermissionState::Granted => Authorization::Granted,
        PermissionState::Denied => Authorization::Denied,
        _ => Authorization::Undetermined,
    }
}

impl Toaster for TauriToaster {
    fn authorization(&self) -> Authorization {
        self.app
            .notification()
            .permission_state()
            .map_or(Authorization::Denied, map_state)
    }

    fn request_authorization(&self) -> Authorization {
        self.app
            .notification()
            .request_permission()
            .map_or(Authorization::Denied, map_state)
    }

    fn show(&self, title: &str, body: &str, sound: bool) -> Result<(), String> {
        let mut builder = self.app.notification().builder().title(title).body(body);
        if sound {
            builder = builder.sound(ALERT_SOUND);
        }
        builder.show().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use domain::{GapStatus, UtcMs};

    use super::*;

    #[derive(Clone)]
    struct FakeToaster {
        state: Arc<Mutex<Authorization>>,
        grant_on_request: bool,
        requests: Arc<Mutex<u32>>,
        shown: Arc<Mutex<Vec<(String, String)>>>,
        sounds: Arc<Mutex<Vec<bool>>>,
        fail_show: bool,
    }

    impl FakeToaster {
        fn new(state: Authorization, grant_on_request: bool) -> Self {
            Self {
                state: Arc::new(Mutex::new(state)),
                grant_on_request,
                requests: Arc::new(Mutex::new(0)),
                shown: Arc::new(Mutex::new(Vec::new())),
                sounds: Arc::new(Mutex::new(Vec::new())),
                fail_show: false,
            }
        }
    }

    impl Toaster for FakeToaster {
        fn authorization(&self) -> Authorization {
            *self.state.lock().unwrap()
        }
        fn request_authorization(&self) -> Authorization {
            *self.requests.lock().unwrap() += 1;
            let next = if self.grant_on_request {
                Authorization::Granted
            } else {
                Authorization::Denied
            };
            *self.state.lock().unwrap() = next;
            next
        }
        fn show(&self, title: &str, body: &str, sound: bool) -> Result<(), String> {
            if self.fail_show {
                return Err("boom".into());
            }
            self.sounds.lock().unwrap().push(sound);
            self.shown
                .lock()
                .unwrap()
                .push((title.to_string(), body.to_string()));
            Ok(())
        }
    }

    fn gap(minutes: i64) -> IdleGap {
        IdleGap {
            id: Some(domain::GapId(1)),
            started_at: UtcMs(0),
            ended_at: UtcMs(minutes * 60_000 + 5_000),
            prev_focus: None,
            status: GapStatus::Pending,
            expires_at: UtcMs(0),
        }
    }

    #[test]
    fn a_granted_user_gets_the_idle_notification() {
        let toaster = FakeToaster::new(Authorization::Granted, false);
        SystemNotifier::new(toaster.clone()).idle_return(&gap(20));
        let shown = toaster.shown.lock().unwrap();
        assert_eq!(shown.len(), 1);
        assert!(shown[0].1.contains("20 minutes"));
        assert_eq!(*toaster.requests.lock().unwrap(), 0);
    }

    #[test]
    fn an_undetermined_state_asks_once_and_shows_when_granted() {
        let toaster = FakeToaster::new(Authorization::Undetermined, true);
        let notifier = SystemNotifier::new(toaster.clone());
        notifier.idle_return(&gap(6));
        notifier.idle_return(&gap(7));
        assert_eq!(*toaster.requests.lock().unwrap(), 1);
        assert_eq!(toaster.shown.lock().unwrap().len(), 2);
    }

    #[test]
    fn a_denied_user_gets_no_notification_and_no_error() {
        let toaster = FakeToaster::new(Authorization::Undetermined, false);
        let notifier = SystemNotifier::new(toaster.clone());
        notifier.idle_return(&gap(6));
        notifier.idle_return(&gap(6));
        // Denied after the first request: never asked again, nothing shown.
        assert_eq!(*toaster.requests.lock().unwrap(), 1);
        assert!(toaster.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn a_failing_toast_is_swallowed() {
        let mut toaster = FakeToaster::new(Authorization::Granted, false);
        toaster.fail_show = true;
        SystemNotifier::new(toaster).idle_return(&gap(6));
    }

    #[test]
    fn the_revocation_alert_is_sent_once() {
        let toaster = FakeToaster::new(Authorization::Granted, false);
        let notifier = SystemNotifier::new(toaster.clone());
        notifier.permission_revoked();
        notifier.permission_revoked();
        assert_eq!(toaster.shown.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_session_wrapper_drops_only_the_revocation_alert() {
        let toaster = FakeToaster::new(Authorization::Granted, false);
        let notifier = WithoutRevocationNotice(Box::new(SystemNotifier::new(toaster.clone())));
        notifier.permission_revoked();
        assert!(toaster.shown.lock().unwrap().is_empty());
        notifier.idle_return(&gap(6));
        assert_eq!(toaster.shown.lock().unwrap().len(), 1);
    }

    #[test]
    fn goal_alerts_are_shown_when_allowed_and_swallowed_when_denied() {
        let granted = FakeToaster::new(Authorization::Granted, false);
        let notifier = SystemNotifier::new(granted.clone());
        notifier.goal_crossed("Deep work", GoalEventKind::Reached);
        notifier.goal_crossed("Email", GoalEventKind::Exceeded);
        let shown = granted.shown.lock().unwrap();
        assert_eq!(shown[0].0, "Goal reached");
        assert!(shown[0].1.contains("Deep work"));
        assert_eq!(shown[1].0, "Limit passed");
        assert!(!shown[1].1.to_lowercase().contains("block"));

        // Denied: no toast and no error; the in-app badge is the fallback.
        let denied = FakeToaster::new(Authorization::Denied, false);
        SystemNotifier::new(denied.clone()).goal_crossed("Email", GoalEventKind::Exceeded);
        assert!(denied.shown.lock().unwrap().is_empty());

        // The session wrapper forwards goal alerts untouched.
        let wrapped = FakeToaster::new(Authorization::Granted, false);
        WithoutRevocationNotice(Box::new(SystemNotifier::new(wrapped.clone())))
            .goal_crossed("Email", GoalEventKind::Exceeded);
        assert_eq!(wrapped.shown.lock().unwrap().len(), 1);
    }

    #[test]
    fn focus_alerts_are_gentle_and_swallowed_when_denied() {
        let granted = FakeToaster::new(Authorization::Granted, false);
        let notifier = SystemNotifier::new(granted.clone());
        notifier.focus_drift("Write report", "Slack");
        assert!(notifier.focus_finished(&end(FocusKind::Focus, "Write report", None, false)));
        let shown = granted.shown.lock().unwrap();
        assert_eq!(shown.len(), 2);
        assert!(shown[0].1.contains("Slack") && shown[0].1.contains("Write report"));
        assert_eq!(shown[1].0, "Focus block done");
        drop(shown);
        // Drift alerts are silent; the end of a block rings.
        assert_eq!(*granted.sounds.lock().unwrap(), vec![false, true]);

        let denied = FakeToaster::new(Authorization::Denied, false);
        let notifier = SystemNotifier::new(denied.clone());
        notifier.focus_drift("a", "b");
        assert!(
            !notifier.focus_finished(&end(FocusKind::Timer, "a", None, false)),
            "the popover chimes instead"
        );
        assert!(denied.shown.lock().unwrap().is_empty());
    }

    fn end(
        kind: FocusKind,
        intent: &str,
        next: Option<(FocusKind, i64)>,
        auto: bool,
    ) -> FocusEndAlert {
        FocusEndAlert {
            kind,
            intent: intent.into(),
            next,
            auto_started: auto,
            sound: true,
        }
    }

    #[test]
    fn the_end_message_says_what_comes_next() {
        const MIN: i64 = 60_000;
        let body = |alert| focus_finished_message(&alert).1;
        assert_eq!(
            body(end(
                FocusKind::Focus,
                "Write report",
                Some((FocusKind::Break, 5 * MIN)),
                false
            )),
            "Write report. Time for a 5-minute break."
        );
        assert_eq!(
            body(end(
                FocusKind::Timer,
                "",
                Some((FocusKind::Break, 15 * MIN)),
                true
            )),
            "Your 15-minute break has started."
        );
        assert_eq!(
            focus_finished_message(&end(
                FocusKind::Break,
                "",
                Some((FocusKind::Timer, 25 * MIN)),
                false
            )),
            (
                "Break is over".to_owned(),
                "Ready for another 25 minutes?".to_owned()
            )
        );
        assert_eq!(
            body(end(
                FocusKind::Break,
                "",
                Some((FocusKind::Focus, 50 * MIN)),
                true
            )),
            "Your next 50-minute block has started."
        );
        assert_eq!(body(end(FocusKind::Timer, "", None, false)), "Nice work.");
        assert_eq!(
            focus_heads_up_message(FocusKind::Timer, "Write report"),
            (
                "One minute left".to_owned(),
                "Time to wrap up: Write report.".to_owned()
            )
        );
        assert_eq!(
            focus_heads_up_message(FocusKind::Break, "").1,
            "Your break ends in a minute."
        );
    }

    #[test]
    fn message_wording_handles_short_gaps_and_never_shows_titles() {
        assert!(idle_message(&gap(0)).contains("less than a minute"));
        assert!(idle_message(&gap(1)).contains("1 minute."));
        let mut with_focus = gap(3);
        with_focus.prev_focus = Some(domain::FocusSnapshot {
            app_id: "a".into(),
            app_name: "Mail".into(),
            pid: 1,
            window_title: Some("Secret subject".into()),
        });
        assert!(!idle_message(&with_focus).contains("Secret"));
    }
}
