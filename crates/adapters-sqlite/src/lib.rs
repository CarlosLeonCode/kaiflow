//! SQLite adapter (rusqlite, bundled). Repositories for every storage port.

mod category_repo;
pub mod db;
pub mod migrations;
mod privacy_repo;
mod report_repo;
mod retention_repo;
mod session_repo;
mod settings_repo;

pub use category_repo::SqliteCategoryRepository;
pub use db::{DbError, open, open_in_memory};
pub use privacy_repo::SqlitePrivacyRepository;
pub use report_repo::SqliteReportRepository;
pub use retention_repo::SqliteRetentionRepository;
pub use session_repo::SqliteSessionRepository;
pub use settings_repo::SqliteSettingsRepository;
