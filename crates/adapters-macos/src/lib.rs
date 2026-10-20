//! macOS adapters (design sections 5 and 6). Everything that touches AppKit or the C
//! frameworks is behind `cfg(target_os = "macos")` so the workspace builds elsewhere.

pub mod permission;
pub mod workspace_observer;
