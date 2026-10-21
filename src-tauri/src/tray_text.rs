//! Live text next to the menu-bar / tray icon, driven by the `tray_display` setting.
//!
//! Split in two halves:
//! - pure formatting and refresh cadence ([`tray_text`], [`tooltip`], [`next_refresh`]),
//!   unit tested below;
//! - the platform glue: a worker thread ([`TrayText`]) that computes the text off the main
//!   thread and hops to the main thread only to hand it to the tray icon.
//!
//! Platforms: macOS shows the text as the status item title (`TrayIcon::set_title`), Linux
//! (libappindicator) as the indicator label (also `set_title`), Windows has no tray text so
//! the tooltip carries it. The tooltip is set on every platform.
//!
//! Width stability: the macOS menu bar uses the system font, whose digits are proportional,
//! and `set_title` offers no font control. To keep the item from jittering every minute the
//! minutes always take two digit columns: zero-padded after hours (`3h 05m`) and padded with
//! a FIGURE SPACE (U+2007, exactly one digit wide) when they stand alone (`␣5m`). The width
//! then changes only when the number of digit columns changes (59m -> 1h 00m, 9h -> 10h).
//!
//! On macOS the status item also gets the system font with monospaced digits
//! (`monospacedDigitSystemFont`), so the per-second countdown never jitters either.
//!
//! Cadence: a refresh on every status / segment change event, and while running one wake-up
//! when a shown total crosses the next whole minute (minute resolution). Paused, idle and
//! asleep only wake at local midnight so the day total resets.
//!
//! Focus blocks: while one runs it takes over the text whatever `tray_display` says
//! (`◔ 24:13 · Write report`, `☕︎ 04:12` for a break, `⏸︎ 24:13` while paused) and the text
//! ticks every second, the only per-second cadence in the app. That path reads nothing but the
//! focus service (no engine round trip, no report), and a paused block waits for events only.
//! When the block ends, the normal text comes back on the next refresh.

use std::sync::Arc;
use std::time::Duration;

use application::commands::TrayDisplay;
use application::engine::{Command, Reply};
use application::ports::{Clock, TrackingKind};
use application::queries::Range;
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, unbounded};
use domain::{FocusKind, UtcMs};
use tauri::{AppHandle, Manager, Wry};

use crate::composition::AppState;
use crate::tray;

/// Longest label for the current-app variants; the app name is shortened to fit.
pub const MAX_LABEL_CHARS: usize = 24;
/// An app name never shrinks below this, even when the rest of the label is long.
const MIN_NAME_CHARS: usize = 6;
/// One digit wide in every font that has tabular figures (U+2007 FIGURE SPACE).
const FIGURE_SPACE: char = '\u{2007}';
/// U+23F8 followed by VS15 so it renders as a monochrome glyph, not a color emoji.
const PAUSED_MARKER: &str = "\u{23F8}\u{FE0E}";
const SEPARATOR: &str = " · ";
/// Quarter-filled circle: a countdown in progress.
const FOCUS_MARKER: &str = "◔";
/// U+2615 HOT BEVERAGE followed by VS15: a monochrome cup for a break.
const BREAK_MARKER: &str = "\u{2615}\u{FE0E}";
/// Replaces the separator while a drift alert is showing.
const DRIFT_SEPARATOR: &str = " ! ";
const APP_NAME: &str = "Kaiflow";

const MINUTE_MS: i64 = 60_000;
const SECOND_MS: i64 = 1_000;
/// Added to the per-second wake-up so the new second is already due when the worker looks.
const SECOND_SLACK_MS: i64 = 15;
/// Added to every computed wake-up: the open segment is persisted on a 2 s heartbeat, so
/// waking a bit after the exact minute guarantees the new minute is already visible.
const SLACK_MS: i64 = 2_500;
/// Lower bound between two timed refreshes.
const MIN_WAIT_MS: i64 = 1_000;
/// Events arriving together (close + open + status) are folded into one refresh.
const DEBOUNCE: Duration = Duration::from_millis(150);
/// Retry delay when the state or the database is not reachable.
const RETRY: Duration = Duration::from_secs(60);

/// The focused app and its tracked time today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppToday<'a> {
    pub name: &'a str,
    pub today_ms: i64,
}

/// The goal the `GoalProgress` variant shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GoalTray {
    pub actual_ms: i64,
    pub target_ms: i64,
}

/// A focus block, timer or break in progress; while one runs it takes over the text (even
/// with the tray text off): the countdown matters more than the day total.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusTray<'a> {
    pub kind: FocusKind,
    /// May be empty: then only the glyph and the countdown show.
    pub intent: &'a str,
    pub remaining_ms: i64,
    pub paused: bool,
    /// A drift alert is showing: the separator turns into `!`.
    pub drifting: bool,
}

/// Everything the text depends on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraySnapshot<'a> {
    pub kind: TrackingKind,
    pub today_ms: i64,
    pub current: Option<AppToday<'a>>,
    /// The top goal; only read by `TrayDisplay::GoalProgress`.
    pub goal: Option<GoalTray>,
    /// The running focus session, if any.
    pub focus: Option<FocusTray<'a>>,
}

/// Minute resolution, two digit columns for the minutes (see the module docs).
pub fn format_duration(ms: i64) -> String {
    let minutes = ms.max(0) / MINUTE_MS;
    let (hours, minutes) = (minutes / 60, minutes % 60);
    match (hours, minutes) {
        (0, m) if m < 10 => format!("{FIGURE_SPACE}{m}m"),
        (0, m) => format!("{m}m"),
        (h, m) => format!("{h}h {m:02}m"),
    }
}

/// A goal target without the zero-padding of [`format_duration`]: `3h`, `3h 30m`, `45m`.
pub fn format_target(ms: i64) -> String {
    let minutes = ms.max(0) / MINUTE_MS;
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m}m"),
        (h, 0) => format!("{h}h"),
        (h, m) => format!("{h}h {m}m"),
    }
}

/// `2h 10m / 3h`, kept within the label limit.
fn goal_text(goal: GoalTray) -> String {
    truncate(
        &format!(
            "{} / {}",
            format_duration(goal.actual_ms),
            format_target(goal.target_ms)
        ),
        MAX_LABEL_CHARS,
    )
}

/// Seconds left, rounded up: `00:01` stays until the block ends, never `00:00` early.
fn seconds_left(remaining_ms: i64) -> i64 {
    (remaining_ms.max(0) + SECOND_MS - 1) / SECOND_MS
}

/// `24:13`, or `1:05:00` from an hour up.
pub fn format_clock(remaining_ms: i64) -> String {
    let total = seconds_left(remaining_ms);
    let (hours, minutes, seconds) = (total / 3600, total % 3600 / 60, total % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

/// `◔ 24:13 · Write report`: the glyph says what runs (a cup for a break, the pause sign while
/// paused), then the countdown, then the task name shortened to keep the label short. The
/// name is the first thing to go when there is no room for it.
pub fn focus_text(focus: FocusTray<'_>) -> String {
    let marker = match (focus.paused, focus.kind) {
        (true, _) => PAUSED_MARKER,
        (false, FocusKind::Break) => BREAK_MARKER,
        (false, _) => FOCUS_MARKER,
    };
    let prefix = format!("{marker} {}", format_clock(focus.remaining_ms));
    let separator = if focus.drifting {
        DRIFT_SEPARATOR
    } else {
        SEPARATOR
    };
    let intent = focus.intent.trim();
    let budget = MAX_LABEL_CHARS.saturating_sub(prefix.chars().count() + separator.chars().count());
    if intent.is_empty() || budget < MIN_NAME_CHARS {
        return if focus.drifting {
            format!("{prefix}{}", DRIFT_SEPARATOR.trim_end())
        } else {
            prefix
        };
    }
    format!("{prefix}{separator}{}", truncate(intent, budget))
}

/// When the shown countdown changes: right after the next whole second goes by. A paused
/// block waits for events only.
pub fn focus_refresh(focus: FocusTray<'_>) -> Option<Duration> {
    if focus.paused {
        return None;
    }
    let left = focus.remaining_ms.max(0);
    let shown = seconds_left(left);
    // At zero the watcher ends the block and asks for a refresh; poll once a second meanwhile.
    let wait = if shown == 0 {
        SECOND_MS
    } else {
        left - (shown - 1) * SECOND_MS + SECOND_SLACK_MS
    };
    Some(Duration::from_millis(wait.max(1).unsigned_abs()))
}

/// Trims `text` and shortens it to at most `max_chars` characters, ending with `…` when cut.
pub fn truncate(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", kept.trim_end())
}

/// `name<sep>tail` with the name shortened so the whole label stays within the limit.
fn with_name(prefix: &str, name: &str, sep: &str, tail: &str) -> String {
    let fixed = prefix.chars().count() + sep.chars().count() + tail.chars().count();
    let budget = MAX_LABEL_CHARS.saturating_sub(fixed).max(MIN_NAME_CHARS);
    format!("{prefix}{}{sep}{tail}", truncate(name, budget))
}

/// Text next to the icon; empty means icon only.
pub fn tray_text(display: TrayDisplay, snap: &TraySnapshot<'_>) -> String {
    // A block runs independently of tracking, so it shows in every tracking state, and it
    // overrides the display choice: the user started a timer to see it.
    if let Some(focus) = snap.focus {
        return focus_text(focus);
    }
    if display == TrayDisplay::Off {
        return String::new();
    }
    // The goal variant replaces the day total; without a goal it falls back to the total.
    let total = match (display, snap.goal) {
        (TrayDisplay::GoalProgress, Some(goal)) => goal_text(goal),
        _ => format_duration(snap.today_ms),
    };
    match snap.kind {
        TrackingKind::Stopped => String::new(),
        TrackingKind::Paused => format!("{PAUSED_MARKER} {total}"),
        // Nothing is being recorded: keep showing the day total.
        TrackingKind::Idle | TrackingKind::Asleep => total,
        TrackingKind::Running => match (display, snap.current) {
            (TrayDisplay::CurrentApp, Some(app)) => {
                with_name("", app.name, SEPARATOR, &format_duration(app.today_ms))
            }
            (TrayDisplay::TodayAndCurrent, Some(app)) => with_name(
                &format!("{total}{SEPARATOR}"),
                app.name,
                " ",
                &format_duration(app.today_ms),
            ),
            _ => total,
        },
    }
}

/// Tooltip on every platform; on Windows it is the only place the text appears.
pub fn tooltip(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() {
        APP_NAME.to_owned()
    } else {
        format!("{APP_NAME} — {text}")
    }
}

/// When the next timed refresh is due; `None` waits for the next event only.
pub fn next_refresh(
    display: TrayDisplay,
    snap: &TraySnapshot<'_>,
    until_midnight_ms: i64,
) -> Option<Duration> {
    let as_wait = |ms: i64| Duration::from_millis(ms.max(MIN_WAIT_MS).unsigned_abs());
    let midnight = until_midnight_ms.max(0) + SLACK_MS;
    if let Some(focus) = snap.focus {
        return focus_refresh(focus);
    }
    match snap.kind {
        _ if display == TrayDisplay::Off => None,
        TrackingKind::Stopped => None,
        TrackingKind::Running => {
            let app = match display {
                TrayDisplay::CurrentApp | TrayDisplay::TodayAndCurrent => {
                    snap.current.map(|a| a.today_ms)
                }
                _ => None,
            };
            let shown_total = match (display, snap.goal) {
                (TrayDisplay::GoalProgress, Some(goal)) => goal.actual_ms,
                _ => snap.today_ms,
            };
            let next_minute = [Some(shown_total), app]
                .into_iter()
                .flatten()
                .map(|ms| MINUTE_MS - ms.max(0).rem_euclid(MINUTE_MS))
                .min()
                .unwrap_or(MINUTE_MS);
            Some(as_wait((next_minute + SLACK_MS).min(midnight)))
        }
        TrackingKind::Paused | TrackingKind::Idle | TrackingKind::Asleep => Some(as_wait(midnight)),
    }
}

/// Today's local-day bounds (DST aware) as a half-open UTC range.
pub fn local_day(now: UtcMs) -> Option<Range> {
    use chrono::{Days, Local, NaiveDate, TimeZone};
    let start_of = |day: NaiveDate| {
        let midnight = day.and_hms_opt(0, 0, 0)?;
        // A midnight skipped by a DST jump starts the day one hour later.
        Local
            .from_local_datetime(&midnight)
            .earliest()
            .or_else(|| {
                Local
                    .from_local_datetime(&(midnight + chrono::TimeDelta::hours(1)))
                    .earliest()
            })
            .map(|t| UtcMs(t.timestamp_millis()))
    };
    let today = Local.timestamp_millis_opt(now.0).single()?.date_naive();
    let range = Range {
        from: start_of(today)?,
        to: start_of(today.checked_add_days(Days::new(1))?)?,
    };
    (range.from <= now && now < range.to).then_some(range)
}

// ---- platform glue ----

enum Msg {
    Refresh,
    Stop,
}

/// Handle to the tray text worker; cheap to clone, every call is non-blocking.
#[derive(Clone)]
pub struct TrayText {
    tx: Sender<Msg>,
}

impl TrayText {
    /// Starts the worker; it refreshes once right away. A failed spawn only disables the
    /// text: the handle stays usable and its calls do nothing.
    pub fn spawn(app: &AppHandle<Wry>) -> Self {
        let (tx, rx) = unbounded();
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("tray-text".into())
            .spawn(move || run(&app, &rx));
        if let Err(error) = spawned {
            eprintln!("could not start the tray text thread: {error}");
        }
        Self { tx }
    }

    /// Asks for a recomputation (engine event, settings change). Safe from any thread,
    /// the engine thread included: it never waits.
    pub fn refresh(&self) {
        let _ = self.tx.send(Msg::Refresh);
    }

    /// Ends the worker (app exit). It does not wait for the thread.
    pub fn stop(&self) {
        let _ = self.tx.send(Msg::Stop);
    }
}

/// Worker loop: wait for an event or the next timed refresh, recompute, push on change.
fn run(app: &AppHandle<Wry>, rx: &Receiver<Msg>) {
    let mut shown: Option<String> = None;
    let mut wait = Some(Duration::ZERO);
    loop {
        let woke = match wait {
            Some(timeout) => rx.recv_timeout(timeout),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match woke {
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Ok(Msg::Refresh) => {
                if !drain(rx) {
                    return;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        let Some(state) = app.try_state::<Arc<AppState>>() else {
            wait = Some(RETRY);
            continue;
        };
        match compute(&state) {
            Ok((text, next)) => {
                if shown.as_deref() != Some(text.as_str()) {
                    apply(app, text.clone());
                    shown = Some(text);
                }
                wait = next;
            }
            Err(error) => {
                eprintln!("tray text: {error}");
                wait = Some(RETRY);
            }
        }
    }
}

/// Swallows the burst of refresh requests following the first one; `false` on stop.
fn drain(rx: &Receiver<Msg>) -> bool {
    loop {
        match rx.recv_timeout(DEBOUNCE) {
            Ok(Msg::Refresh) => {}
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return false,
            Err(RecvTimeoutError::Timeout) => return true,
        }
    }
}

/// Reads the setting, the status and today's totals. Runs on the worker thread only.
fn compute(state: &AppState) -> Result<(String, Option<Duration>), String> {
    // A running block is all the text shows: the cheap per-second path, no engine round trip.
    let now = state.clock.now();
    if let Some(session) = state.focus.tray(now) {
        let focus = FocusTray {
            kind: session.kind,
            intent: &session.intent,
            remaining_ms: session.remaining_ms,
            paused: session.paused,
            drifting: session.drifting,
        };
        return Ok((focus_text(focus), focus_refresh(focus)));
    }
    let display = state
        .commands
        .get_settings()
        .map_err(|e| e.to_string())?
        .tray_display;
    if display == TrayDisplay::Off {
        return Ok((String::new(), None));
    }
    let status = match state
        .engine
        .request(Command::GetStatus)
        .map_err(|e| format!("engine: {e:?}"))?
    {
        Reply::Status(status) => status,
        other => return Err(format!("unexpected engine reply: {other:?}")),
    };
    let day = local_day(now).ok_or("could not resolve the local day")?;
    let (today_ms, app) = if status.kind == TrackingKind::Stopped {
        (0, None)
    } else {
        let report = state
            .queries
            .range_report(day, &[], now)
            .map_err(|e| e.to_string())?;
        let app = status.current.as_ref().map(|focus| {
            let today_ms = report
                .by_app
                .iter()
                .find(|a| a.app_id.as_deref() == Some(focus.app_id.as_str()))
                .map_or(0, |a| a.total_ms);
            (focus.app_name.clone(), today_ms)
        });
        (report.total_ms, app)
    };
    let goal = if display == TrayDisplay::GoalProgress {
        state
            .goals
            .tray_goal(now)
            .map_err(|e| e.to_string())?
            .map(|g| GoalTray {
                actual_ms: g.actual_ms,
                target_ms: g.target_ms,
            })
    } else {
        None
    };
    let snap = TraySnapshot {
        kind: status.kind,
        today_ms,
        current: app.as_ref().map(|(name, today_ms)| AppToday {
            name,
            today_ms: *today_ms,
        }),
        goal,
        focus: None,
    };
    Ok((
        tray_text(display, &snap),
        next_refresh(display, &snap, day.to.since(now)),
    ))
}

/// Hands the text to the tray. Queued on the main thread and never awaited: the tray calls
/// block until the main thread runs them, so they must not run on the worker directly.
fn apply(app: &AppHandle<Wry>, text: String) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(icon) = handle.tray_by_id(tray::TRAY_ID) else {
            return;
        };
        #[cfg(target_os = "macos")]
        let _ = icon.with_inner_tray_icon(|inner| {
            if let Some(item) = inner.ns_status_item() {
                monospaced_digits(&item);
            }
        });
        // Windows has no tray text; there the tooltip below is the only carrier.
        #[cfg(not(target_os = "windows"))]
        let _ = icon.set_title((!text.is_empty()).then_some(text.as_str()));
        let _ = icon.set_tooltip(Some(tooltip(&text)));
    });
}

/// Gives the status item the menu-bar system font with fixed-width digits, so a ticking
/// countdown keeps its width. Main thread only (it is a no-op elsewhere).
#[cfg(target_os = "macos")]
fn monospaced_digits(item: &objc2_app_kit::NSStatusItem) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSFont, NSFontWeightRegular};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(button) = item.button(mtm) else {
        return;
    };
    // SAFETY: reading an immutable AppKit constant.
    let weight = unsafe { NSFontWeightRegular };
    let font = NSFont::monospacedDigitSystemFontOfSize_weight(NSFont::systemFontSize(), weight);
    button.setFont(Some(&font));
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = MINUTE_MS;
    const HOUR: i64 = 60 * MIN;

    fn running(today_ms: i64, current: Option<AppToday<'_>>) -> TraySnapshot<'_> {
        TraySnapshot {
            kind: TrackingKind::Running,
            today_ms,
            current,
            goal: None,
            focus: None,
        }
    }

    fn xcode(today_ms: i64) -> Option<AppToday<'static>> {
        Some(AppToday {
            name: "Xcode",
            today_ms,
        })
    }

    #[test]
    fn durations_have_minute_resolution_and_two_minute_columns() {
        assert_eq!(format_duration(0), "\u{2007}0m");
        assert_eq!(format_duration(59_999), "\u{2007}0m");
        assert_eq!(format_duration(5 * MIN), "\u{2007}5m");
        assert_eq!(format_duration(45 * MIN + 30_000), "45m");
        assert_eq!(format_duration(HOUR), "1h 00m");
        assert_eq!(format_duration(3 * HOUR + 12 * MIN), "3h 12m");
        assert_eq!(format_duration(3 * HOUR + 5 * MIN), "3h 05m");
        assert_eq!(format_duration(27 * HOUR), "27h 00m");
        assert_eq!(format_duration(-5), "\u{2007}0m");
    }

    #[test]
    fn same_digit_count_means_same_width() {
        let width = |ms| format_duration(ms).chars().count();
        assert_eq!(width(MIN), width(59 * MIN));
        assert_eq!(width(HOUR), width(9 * HOUR + 59 * MIN));
    }

    #[test]
    fn truncation_adds_an_ellipsis_only_when_cut() {
        assert_eq!(truncate("Xcode", 10), "Xcode");
        assert_eq!(truncate("  Xcode  ", 5), "Xcode");
        assert_eq!(truncate("Visual Studio Code", 10), "Visual St…");
        // A cut right after a space does not leave it dangling before the ellipsis.
        assert_eq!(truncate("Visual Studio Code", 8), "Visual…");
        assert_eq!(truncate("ÄÖÜ漢字テスト", 4), "ÄÖÜ…");
        assert_eq!(truncate("abc", 0), "…");
    }

    #[test]
    fn off_shows_nothing_in_any_state() {
        for kind in [
            TrackingKind::Running,
            TrackingKind::Paused,
            TrackingKind::Idle,
            TrackingKind::Asleep,
            TrackingKind::Stopped,
        ] {
            let snap = TraySnapshot {
                kind,
                today_ms: HOUR,
                current: xcode(MIN),
                goal: None,
                focus: None,
            };
            assert_eq!(tray_text(TrayDisplay::Off, &snap), "");
        }
    }

    #[test]
    fn today_total_shows_the_day_total() {
        let snap = running(3 * HOUR + 12 * MIN, xcode(40 * MIN));
        assert_eq!(tray_text(TrayDisplay::TodayTotal, &snap), "3h 12m");
    }

    #[test]
    fn current_app_shows_the_app_and_its_time_today() {
        let snap = running(3 * HOUR, xcode(40 * MIN));
        assert_eq!(tray_text(TrayDisplay::CurrentApp, &snap), "Xcode · 40m");
        // Without a focused app (excluded or unknown) it falls back to the day total.
        assert_eq!(
            tray_text(TrayDisplay::CurrentApp, &running(3 * HOUR, None)),
            "3h 00m"
        );
    }

    #[test]
    fn long_app_names_are_cut_to_fit_the_label() {
        let snap = running(
            HOUR,
            Some(AppToday {
                name: "Microsoft Visual Studio Code - Insiders",
                today_ms: 2 * HOUR + 3 * MIN,
            }),
        );
        let text = tray_text(TrayDisplay::CurrentApp, &snap);
        assert_eq!(text, "Microsoft Visu… · 2h 03m");
        assert!(text.chars().count() <= MAX_LABEL_CHARS);
        assert!(text.contains('…'));
    }

    #[test]
    fn today_and_current_combines_both() {
        let snap = running(3 * HOUR + 12 * MIN, xcode(40 * MIN));
        assert_eq!(
            tray_text(TrayDisplay::TodayAndCurrent, &snap),
            "3h 12m · Xcode 40m"
        );
        let long = running(
            10 * HOUR,
            Some(AppToday {
                name: "A Very Long Application Name",
                today_ms: 10 * HOUR,
            }),
        );
        let text = tray_text(TrayDisplay::TodayAndCurrent, &long);
        // The name keeps a readable minimum even when the totals are long.
        assert_eq!(text, "10h 00m · A Ver… 10h 00m");
    }

    #[test]
    fn paused_idle_asleep_and_stopped() {
        for display in [
            TrayDisplay::TodayTotal,
            TrayDisplay::CurrentApp,
            TrayDisplay::TodayAndCurrent,
        ] {
            let at = |kind| TraySnapshot {
                kind,
                today_ms: 3 * HOUR + 12 * MIN,
                current: xcode(40 * MIN),
                goal: None,
                focus: None,
            };
            assert_eq!(
                tray_text(display, &at(TrackingKind::Paused)),
                "\u{23F8}\u{FE0E} 3h 12m"
            );
            assert_eq!(tray_text(display, &at(TrackingKind::Idle)), "3h 12m");
            assert_eq!(tray_text(display, &at(TrackingKind::Asleep)), "3h 12m");
            assert_eq!(tray_text(display, &at(TrackingKind::Stopped)), "");
        }
    }

    fn with_goal(kind: TrackingKind, actual_ms: i64, target_ms: i64) -> TraySnapshot<'static> {
        TraySnapshot {
            kind,
            today_ms: 5 * HOUR,
            current: xcode(40 * MIN),
            goal: Some(GoalTray {
                actual_ms,
                target_ms,
            }),
            focus: None,
        }
    }

    #[test]
    fn targets_are_compact() {
        assert_eq!(format_target(3 * HOUR), "3h");
        assert_eq!(format_target(3 * HOUR + 30 * MIN), "3h 30m");
        assert_eq!(format_target(45 * MIN), "45m");
        assert_eq!(format_target(0), "0m");
    }

    #[test]
    fn goal_progress_shows_the_top_goal_and_fits_the_limit() {
        let snap = with_goal(TrackingKind::Running, 2 * HOUR + 10 * MIN, 3 * HOUR);
        assert_eq!(tray_text(TrayDisplay::GoalProgress, &snap), "2h 10m / 3h");
        assert_eq!(
            tray_text(
                TrayDisplay::GoalProgress,
                &with_goal(TrackingKind::Paused, 30 * MIN, HOUR + 30 * MIN)
            ),
            "\u{23F8}\u{FE0E} 30m / 1h 30m"
        );
        assert_eq!(
            tray_text(
                TrayDisplay::GoalProgress,
                &with_goal(TrackingKind::Stopped, 30 * MIN, HOUR)
            ),
            ""
        );
        // The longest realistic label still fits the 24 character limit.
        let long = tray_text(
            TrayDisplay::GoalProgress,
            &with_goal(
                TrackingKind::Running,
                100 * HOUR + 59 * MIN,
                124 * HOUR + 59 * MIN,
            ),
        );
        assert!(long.chars().count() <= MAX_LABEL_CHARS, "{long}");
        // Other variants ignore the goal.
        assert_eq!(
            tray_text(
                TrayDisplay::TodayTotal,
                &with_goal(TrackingKind::Running, MIN, HOUR)
            ),
            "5h 00m"
        );
    }

    #[test]
    fn goal_progress_without_a_goal_shows_the_day_total() {
        let snap = running(3 * HOUR + 12 * MIN, xcode(40 * MIN));
        assert_eq!(tray_text(TrayDisplay::GoalProgress, &snap), "3h 12m");
    }

    #[test]
    fn goal_progress_wakes_when_the_goal_minute_changes() {
        let snap = with_goal(TrackingKind::Running, 2 * HOUR + 20_000, 3 * HOUR);
        assert_eq!(
            next_refresh(TrayDisplay::GoalProgress, &snap, 10 * HOUR),
            Some(Duration::from_millis(40_000 + 2_500))
        );
    }

    fn with_focus(
        kind: TrackingKind,
        intent: &'static str,
        remaining_ms: i64,
        drifting: bool,
    ) -> TraySnapshot<'static> {
        TraySnapshot {
            kind,
            today_ms: 5 * HOUR,
            current: xcode(40 * MIN),
            goal: None,
            focus: Some(FocusTray {
                kind: FocusKind::Focus,
                intent,
                remaining_ms,
                paused: false,
                drifting,
            }),
        }
    }

    fn block(kind: FocusKind, intent: &str, remaining_ms: i64, paused: bool) -> FocusTray<'_> {
        FocusTray {
            kind,
            intent,
            remaining_ms,
            paused,
            drifting: false,
        }
    }

    #[test]
    fn the_clock_rounds_up_to_the_second_and_adds_hours_when_needed() {
        assert_eq!(format_clock(24 * MIN + 13_000), "24:13");
        assert_eq!(format_clock(24 * MIN + 12_001), "24:13");
        assert_eq!(format_clock(4 * MIN + 12_000), "04:12");
        assert_eq!(format_clock(1), "00:01");
        assert_eq!(format_clock(0), "00:00");
        assert_eq!(format_clock(-5), "00:00");
        assert_eq!(format_clock(HOUR + 5 * MIN), "1:05:00");
        assert_eq!(format_clock(60 * MIN), "1:00:00");
        // Same digit count, same width (the font has fixed-width digits).
        assert_eq!(format_clock(MIN).len(), format_clock(59 * MIN).len());
    }

    #[test]
    fn a_running_block_shows_the_countdown_and_the_task_in_every_display() {
        let snap = with_focus(
            TrackingKind::Running,
            "Write report",
            24 * MIN + 13_000,
            false,
        );
        for display in [
            TrayDisplay::Off,
            TrayDisplay::TodayTotal,
            TrayDisplay::CurrentApp,
            TrayDisplay::TodayAndCurrent,
            TrayDisplay::GoalProgress,
        ] {
            assert_eq!(tray_text(display, &snap), "◔ 24:13 · Write report");
        }
        assert_eq!(
            tray_text(
                TrayDisplay::TodayTotal,
                &with_focus(TrackingKind::Running, "Write report", HOUR + 5 * MIN, false)
            ),
            "◔ 1:05:00 · Write report"
        );
    }

    #[test]
    fn a_block_shows_whatever_the_tracking_state_is() {
        for kind in [
            TrackingKind::Running,
            TrackingKind::Paused,
            TrackingKind::Idle,
            TrackingKind::Asleep,
            TrackingKind::Stopped,
        ] {
            let snap = with_focus(kind, "Write report", 10 * MIN, false);
            assert_eq!(
                tray_text(TrayDisplay::TodayTotal, &snap),
                "◔ 10:00 · Write report"
            );
        }
    }

    #[test]
    fn breaks_pauses_and_untitled_blocks_have_their_own_look() {
        assert_eq!(
            focus_text(block(FocusKind::Break, "", 4 * MIN + 12_000, false)),
            "\u{2615}\u{FE0E} 04:12"
        );
        assert_eq!(
            focus_text(block(FocusKind::Timer, "", 25 * MIN, false)),
            "◔ 25:00"
        );
        assert_eq!(
            focus_text(block(FocusKind::Timer, "Read", 25 * MIN, true)),
            "\u{23F8}\u{FE0E} 25:00 · Read"
        );
    }

    #[test]
    fn a_drift_swaps_the_separator_for_a_marker() {
        let snap = with_focus(TrackingKind::Running, "Write report", 23 * MIN, true);
        assert_eq!(
            tray_text(TrayDisplay::TodayTotal, &snap),
            "◔ 23:00 ! Write report"
        );
    }

    #[test]
    fn a_long_task_name_is_cut_to_the_label_limit() {
        for (intent, remaining) in [
            (
                "Prepare the quarterly planning review for the board",
                23 * MIN,
            ),
            (
                "Prepare the quarterly planning review for the board",
                10 * HOUR + 5 * MIN,
            ),
            ("ÄÖÜ漢字テスト漢字テスト漢字テスト漢字テスト", 59 * MIN),
        ] {
            for drifting in [false, true] {
                let text = tray_text(
                    TrayDisplay::TodayTotal,
                    &with_focus(TrackingKind::Running, intent, remaining, drifting),
                );
                assert!(text.chars().count() <= MAX_LABEL_CHARS, "{text}");
                assert!(text.contains('…'), "{text}");
            }
        }
        assert_eq!(
            tray_text(
                TrayDisplay::TodayTotal,
                &with_focus(
                    TrackingKind::Running,
                    "Prepare the quarterly planning review",
                    23 * MIN,
                    false
                )
            ),
            "◔ 23:00 · Prepare the q…"
        );
    }

    #[test]
    fn the_countdown_ticks_every_second_and_a_paused_block_waits_for_events() {
        let wake = |remaining| focus_refresh(block(FocusKind::Focus, "x", remaining, false));
        // 23:20.400 shows 23:21 until 23:20 is left: 400 ms away.
        assert_eq!(
            wake(23 * MIN + 20_400),
            Some(Duration::from_millis(400 + 15))
        );
        assert_eq!(wake(5 * MIN), Some(Duration::from_millis(1_000 + 15)));
        assert_eq!(wake(0), Some(Duration::from_millis(1_000)));
        assert_eq!(focus_refresh(block(FocusKind::Focus, "x", MIN, true)), None);
        // Through the snapshot too, whatever the display.
        assert_eq!(
            next_refresh(
                TrayDisplay::Off,
                &with_focus(TrackingKind::Paused, "x", 5 * MIN, false),
                HOUR
            ),
            Some(Duration::from_millis(1_015))
        );
    }

    #[test]
    fn tooltip_names_the_app_and_carries_the_text() {
        assert_eq!(tooltip(""), "Kaiflow");
        assert_eq!(tooltip("3h 12m"), "Kaiflow — 3h 12m");
        assert_eq!(tooltip("\u{2007}5m"), "Kaiflow — 5m");
    }

    #[test]
    fn running_wakes_when_the_shown_minute_changes() {
        let far = 10 * HOUR;
        let snap = running(3 * HOUR + 12 * MIN + 20_000, None);
        assert_eq!(
            next_refresh(TrayDisplay::TodayTotal, &snap, far),
            Some(Duration::from_millis(40_000 + 2_500))
        );
        // The app total is only considered when the app is shown.
        let snap = running(10_000, xcode(50_000));
        assert_eq!(
            next_refresh(TrayDisplay::TodayTotal, &snap, far),
            Some(Duration::from_millis(50_000 + 2_500))
        );
        assert_eq!(
            next_refresh(TrayDisplay::CurrentApp, &snap, far),
            Some(Duration::from_millis(10_000 + 2_500))
        );
        // Never more often than the floor, never later than a minute and change.
        let exact = running(5 * MIN, None);
        assert_eq!(
            next_refresh(TrayDisplay::TodayTotal, &exact, far),
            Some(Duration::from_millis(62_500))
        );
        // Midnight comes first when it is closer.
        assert_eq!(
            next_refresh(TrayDisplay::TodayTotal, &exact, 0),
            Some(Duration::from_millis(2_500))
        );
    }

    #[test]
    fn other_states_only_wake_for_the_day_change() {
        let at = |kind| TraySnapshot {
            kind,
            today_ms: HOUR,
            current: None,
            goal: None,
            focus: None,
        };
        for kind in [
            TrackingKind::Paused,
            TrackingKind::Idle,
            TrackingKind::Asleep,
        ] {
            assert_eq!(
                next_refresh(TrayDisplay::TodayTotal, &at(kind), HOUR),
                Some(Duration::from_millis(3_600_000 + 2_500))
            );
        }
        assert_eq!(
            next_refresh(TrayDisplay::TodayTotal, &at(TrackingKind::Stopped), HOUR),
            None
        );
        assert_eq!(
            next_refresh(TrayDisplay::Off, &at(TrackingKind::Running), HOUR),
            None
        );
    }

    #[test]
    fn the_local_day_contains_now_and_spans_about_a_day() {
        let now = UtcMs(1_760_000_000_000);
        let day = local_day(now).unwrap();
        assert!(day.from <= now && now < day.to);
        assert!((23 * HOUR..=25 * HOUR).contains(&day.to.since(day.from)));
    }
}
