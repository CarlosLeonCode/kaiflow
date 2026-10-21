//! Platform-neutral adapter logic (design sections 5 and 6). Every OS adapter crate feeds the
//! same [`sampler::SamplerCore`] through a small [`sampler::SamplerEnv`]; only reading the
//! foreground window, its title and the idle counter differs per platform. Nothing here
//! touches an OS API, so all of it is unit tested on every platform.

pub mod activation;
pub mod fanout;
pub mod files;
pub mod idle;
pub mod permission;
pub mod sampler;
