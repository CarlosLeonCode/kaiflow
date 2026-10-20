//! SQLite adapter (rusqlite, bundled). Write repositories live here; read-side ones follow.

pub mod db;
pub mod migrations;
mod session_repo;
mod settings_repo;

pub use db::{DbError, open, open_in_memory};
pub use session_repo::SqliteSessionRepository;
pub use settings_repo::SqliteSettingsRepository;
