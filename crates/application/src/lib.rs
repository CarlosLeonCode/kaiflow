//! Application layer: ports, effect execution and the single engine thread.

pub mod effects_executor;
pub mod engine;
#[cfg(any(test, feature = "test-fakes"))]
pub mod fakes;
pub mod ports;
