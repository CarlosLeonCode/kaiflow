//! macOS adapters (design sections 5 and 6). Everything that touches AppKit or the C
//! frameworks is behind `cfg(target_os = "macos")` so the workspace builds elsewhere; the
//! decision logic (sampler core, idle tracker, signal mapping) is plain Rust with tests.

pub mod ax;
pub mod idle;
pub mod lock;
pub mod permission;
pub mod sampler;
pub mod workspace_observer;
