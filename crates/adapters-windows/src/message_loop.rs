//! The "win-events" thread: one hidden window and one WinEvent hook served by the same
//! message loop.
//!
//! - `EVENT_SYSTEM_FOREGROUND` (out-of-context hook) reports app switches immediately; the
//!   sampler also polls `GetForegroundWindow`, so a missed event only delays a switch by a tick.
//! - `WM_WTSSESSION_CHANGE` (after `WTSRegisterSessionNotification`) reports lock/unlock.
//! - `WM_POWERBROADCAST` reports suspend/resume and `WM_ENDSESSION` a shutdown or log-off.
//!
//! The window is a hidden top-level window rather than a message-only one (`HWND_MESSAGE`):
//! message-only windows do not receive broadcast messages such as `WM_POWERBROADCAST` and
//! `WM_ENDSESSION`. It is never shown and has the tool-window style, so it does not appear in
//! the taskbar or Alt+Tab. The thread lives as long as the process, like the macOS observers.

use std::cell::RefCell;
use std::sync::Arc;
use std::thread::JoinHandle;

use adapters_common::activation::Activation;
use adapters_common::fanout::SignalFanout;
use crossbeam_channel::Sender;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{
    NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, EVENT_SYSTEM_FOREGROUND,
    GetMessageW, MSG, RegisterClassW, TranslateMessage, WINEVENT_OUTOFCONTEXT, WNDCLASSW,
    WS_EX_TOOLWINDOW, WS_OVERLAPPED,
};
use windows::core::{PCWSTR, w};

use crate::events::{WM_POWERBROADCAST, is_foreground_change, signal_for_message};
use crate::foreground::{DescriptionCache, activation_for};

/// What the callbacks need. Callbacks run on the loop thread only, so a thread local is
/// enough (the Win32 callbacks carry no user data pointer).
struct LoopState {
    activations: Sender<Activation>,
    power: SignalFanout,
    cache: Arc<DescriptionCache>,
}

thread_local! {
    static STATE: RefCell<Option<LoopState>> = const { RefCell::new(None) };
}

pub fn spawn(
    activations: Sender<Activation>,
    power: SignalFanout,
    cache: Arc<DescriptionCache>,
) -> std::io::Result<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("win-events".into())
        .spawn(move || {
            STATE.with(|state| {
                *state.borrow_mut() = Some(LoopState {
                    activations,
                    power,
                    cache,
                });
            });
            if let Err(error) = run() {
                // Polling in the sampler keeps focus tracking alive; only lock/sleep is lost.
                eprintln!("Windows event window unavailable: {error}");
            }
        })
}

fn run() -> windows::core::Result<()> {
    // SAFETY (whole function): standard Win32 window creation and message loop on the thread
    // that owns the window and the hook; every pointer passed lives for the call.
    unsafe {
        let instance: HINSTANCE = GetModuleHandleW(PCWSTR::null())?.into();
        let class_name = w!("KaiflowEventWindow");
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class_name,
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(windows::core::Error::from_thread());
        }
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            class_name,
            w!("Kaiflow events"),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(instance),
            None,
        )?;

        let session = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
        if let Err(error) = &session {
            eprintln!("lock/unlock notifications unavailable: {error}");
        }

        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(foreground_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        if hook.0.is_null() {
            eprintln!("foreground hook unavailable; app switches are picked up by polling");
        }

        let mut message = MSG::default();
        // 0 is WM_QUIT and -1 an error: both end the loop.
        while GetMessageW(&mut message, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        if !hook.0.is_null() {
            let _ = UnhookWinEvent(hook);
        }
        if session.is_ok() {
            let _ = WTSUnRegisterSessionNotification(hwnd);
        }
        let _ = DestroyWindow(hwnd);
    }
    Ok(())
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if let Some(signal) = signal_for_message(message, wparam.0) {
        STATE.with(|state| {
            if let Some(state) = state.borrow().as_ref() {
                state.power.send(signal);
            }
        });
    }
    if message == WM_POWERBROADCAST {
        // TRUE: never veto a power transition.
        return LRESULT(1);
    }
    // SAFETY: forwarding the unchanged arguments of this window's own message.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

unsafe extern "system" fn foreground_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    if !is_foreground_change(event, id_object, !hwnd.is_invalid()) {
        return;
    }
    STATE.with(|state| {
        if let Some(state) = state.borrow().as_ref()
            && let Some(activation) = activation_for(hwnd, &state.cache)
        {
            // Full queue: the sampler is behind and polls the foreground window anyway.
            let _ = state.activations.try_send(activation);
        }
    });
}
