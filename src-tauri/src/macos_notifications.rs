//! What macOS will really do with a notification of this app.
//!
//! `tauri-plugin-notification` reports "granted" on every desktop and posts through the legacy
//! `NSUserNotificationCenter`, so it cannot tell a banner that rang from one that went straight
//! to Notification Center in silence. The permission and the per-app settings live in the
//! `UserNotifications` framework, which works only inside an app bundle (`tauri dev` runs a
//! bare binary: every function here then answers `None` and callers keep the plugin's view).
//!
//! macOS also never presents a banner, nor plays its sound, for the app in front.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::NSError;
use objc2_user_notifications::{
    UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSetting,
    UNNotificationSettings, UNUserNotificationCenter,
};

/// Set when the framework refuses this app (`UNErrorDomain` 1, "notifications are not
/// allowed": ad-hoc signed builds). Its status then stays "not determined" forever while the
/// legacy notifications the plugin posts are shown, so it is no longer consulted.
static UNAVAILABLE: AtomicBool = AtomicBool::new(false);

/// How long to wait for the notification daemon before giving up on its answer.
const SETTINGS_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    NotDetermined,
    Denied,
    /// Authorized, provisional or ephemeral.
    Allowed,
}

/// The per-app notification settings that matter for an alert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub status: Status,
    /// Banners or alerts are shown (the style is not "None").
    pub banners: bool,
    /// The notification may play its sound.
    pub sound: bool,
}

/// `UNUserNotificationCenter` raises an Objective-C exception outside an app bundle.
fn in_app_bundle() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.to_str().map(|p| p.contains(".app/Contents/MacOS/")))
        .unwrap_or(false)
}

/// The current settings, or `None` outside a bundle or when the daemon does not answer.
pub fn settings() -> Option<Settings> {
    if !in_app_bundle() || UNAVAILABLE.load(Ordering::SeqCst) {
        return None;
    }
    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |settings: std::ptr::NonNull<UNNotificationSettings>| {
        // SAFETY: the framework passes a valid settings object for the call's duration.
        let settings = unsafe { settings.as_ref() };
        let status = match settings.authorizationStatus() {
            UNAuthorizationStatus::NotDetermined => Status::NotDetermined,
            UNAuthorizationStatus::Denied => Status::Denied,
            _ => Status::Allowed,
        };
        let _ = tx.send(Settings {
            status,
            banners: settings.alertSetting() == UNNotificationSetting::Enabled
                && settings.alertStyle() != UNAlertStyle::None,
            sound: settings.soundSetting() == UNNotificationSetting::Enabled,
        });
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&handler);
    rx.recv_timeout(SETTINGS_TIMEOUT).ok()
}

/// Shows the system permission dialog when the user was never asked. Does not wait for the
/// answer (the user may take minutes); `false` when the framework cannot be used.
pub fn request_authorization() -> bool {
    if !in_app_bundle() || UNAVAILABLE.load(Ordering::SeqCst) {
        return false;
    }
    let handler = RcBlock::new(|granted: Bool, error: *mut NSError| {
        if !error.is_null() {
            // SAFETY: a non-null error is a valid NSError for the call's duration.
            let error = unsafe { &*error };
            UNAVAILABLE.store(true, Ordering::SeqCst);
            eprintln!(
                "the notification permission cannot be read or requested ({}); \
                 relying on the legacy notification center",
                error.localizedDescription()
            );
        } else if !granted.as_bool() {
            eprintln!("notification permission was not granted");
        }
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &handler,
        );
    true
}

/// Whether Kaiflow is the active app (one of its windows has the keyboard). Thread-safe.
pub fn app_is_active() -> bool {
    NSRunningApplication::currentApplication().isActive()
}
