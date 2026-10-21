//! Application layer: ports, effect execution and the single engine thread.

pub mod backup;
pub mod commands;
pub mod dashboard;
pub mod effects_executor;
pub mod engine;
pub mod export;
#[cfg(any(test, feature = "test-fakes"))]
pub mod fakes;
pub mod goals;
pub mod idle_policy;
pub mod ports;
pub mod presets;
pub mod queries;
pub mod settings_blobs;
