//! The error every IPC command returns (design section 8): a tagged union the frontend can
//! switch on. Storage details are carried as text only; nothing here exposes internals.

use application::commands::CommandError;
use application::effects_executor::ResolveError;
use application::engine::EngineError;
use application::export::DataError;
use application::focus::FocusServiceError;
use application::ports::PortError;
use application::queries::QueryError;
use application::review::ReviewError;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ipc::ai_dto::AiFailureDto;
use crate::ipc::dto::DegradedReasonDto;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppError {
    /// A title pattern did not compile (R9.4); nothing was saved.
    #[error("invalid pattern `{pattern}`: {reason}")]
    InvalidPattern { pattern: String, reason: String },
    /// The global shortcut could not be registered (R6.3); the other settings were saved.
    #[error("shortcut {shortcut} unavailable: {reason}")]
    ShortcutUnavailable { shortcut: String, reason: String },
    #[error("permission denied")]
    PermissionDenied,
    #[error("not found")]
    NotFound,
    #[error("storage failure: {message}")]
    Storage { message: String },
    /// A destructive operation without a valid `confirm_token` (R10.4).
    #[error("confirmation required")]
    ConfirmationRequired,
    /// Input rejected before reaching storage (empty name, bad range...). Added to the
    /// design's list so validation failures are not reported as storage failures.
    #[error("{message}")]
    Invalid { message: String },
    /// A focus session cannot run while tracking is degraded: windows cannot be observed, so
    /// there is nothing to detect drift with. `reason` says why, so the UI can explain it.
    #[error("focus sessions are unavailable while tracking is degraded")]
    FocusUnavailable { reason: DegradedReasonDto },
    /// The AI provider was not switched on by the user: nothing was sent anywhere.
    #[error("AI analysis is not enabled for this provider")]
    AiNotEnabled,
    /// The provider needs an API key and none is saved.
    #[error("no API key is saved for this provider")]
    AiKeyMissing,
    /// The OS has no secure place for API keys; they are never kept anywhere less safe.
    #[error("secure key storage is unavailable: {reason}")]
    SecretStoreUnavailable { reason: String },
    /// The provider call failed. `message` is written for the user and never has the key.
    #[error("{message}")]
    Ai {
        reason: AiFailureDto,
        message: String,
    },
    /// Infrastructure failure (engine thread gone, dialog or file errors).
    #[error("internal error: {message}")]
    Internal { message: String },
}

impl From<PortError> for AppError {
    fn from(e: PortError) -> Self {
        Self::Storage { message: e.0 }
    }
}

impl From<CommandError> for AppError {
    fn from(e: CommandError) -> Self {
        match e {
            CommandError::InvalidPattern(p) => Self::InvalidPattern {
                pattern: p.pattern,
                reason: p.reason,
            },
            CommandError::Invalid(message) => Self::Invalid { message },
            CommandError::NotFound => Self::NotFound,
            CommandError::ConfirmationRequired => Self::ConfirmationRequired,
            CommandError::Storage(e) => e.into(),
        }
    }
}

impl From<DataError> for AppError {
    fn from(e: DataError) -> Self {
        match e {
            DataError::Invalid(message) => Self::Invalid { message },
            DataError::ConfirmationRequired => Self::ConfirmationRequired,
            DataError::Storage(e) => e.into(),
        }
    }
}

impl From<FocusServiceError> for AppError {
    fn from(e: FocusServiceError) -> Self {
        match e {
            FocusServiceError::Invalid(e) => Self::Invalid {
                message: e.to_string(),
            },
            FocusServiceError::Unavailable(reason) => Self::FocusUnavailable {
                reason: reason.into(),
            },
            FocusServiceError::Storage(e) => e.into(),
        }
    }
}

impl From<ReviewError> for AppError {
    fn from(e: ReviewError) -> Self {
        match e {
            ReviewError::NotEnabled => Self::AiNotEnabled,
            ReviewError::KeyMissing => Self::AiKeyMissing,
            ReviewError::SecretStoreUnavailable(reason) => Self::SecretStoreUnavailable { reason },
            ReviewError::Ai(error) => Self::Ai {
                reason: (&error).into(),
                message: error.to_string(),
            },
            ReviewError::ConfirmationRequired => Self::ConfirmationRequired,
            ReviewError::NotFound => Self::NotFound,
            ReviewError::Storage(e) => e.into(),
            ReviewError::Busy | ReviewError::Invalid(_) | ReviewError::SecretStore(_) => {
                Self::Invalid {
                    message: e.to_string(),
                }
            }
        }
    }
}

impl From<QueryError> for AppError {
    fn from(e: QueryError) -> Self {
        match e {
            QueryError::InvalidRange => Self::Invalid {
                message: e.to_string(),
            },
            QueryError::Port(e) => e.into(),
        }
    }
}

impl From<EngineError> for AppError {
    fn from(e: EngineError) -> Self {
        match e {
            // An expired gap is gone for the user too (it counts as discarded).
            EngineError::Resolve(ResolveError::NotFound | ResolveError::Expired) => Self::NotFound,
            EngineError::Resolve(ResolveError::Storage(e)) => e.into(),
            EngineError::Stopped => Self::Internal {
                message: "the tracking engine is not running".into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use domain::InvalidPattern;

    use super::*;

    #[test]
    fn command_errors_keep_their_meaning() {
        let invalid = AppError::from(CommandError::InvalidPattern(InvalidPattern {
            pattern: "(".into(),
            reason: "unclosed group".into(),
        }));
        assert_eq!(
            invalid,
            AppError::InvalidPattern {
                pattern: "(".into(),
                reason: "unclosed group".into()
            }
        );
        assert_eq!(
            AppError::from(CommandError::ConfirmationRequired),
            AppError::ConfirmationRequired
        );
        assert_eq!(AppError::from(CommandError::NotFound), AppError::NotFound);
        assert_eq!(
            AppError::from(CommandError::Invalid("empty".into())),
            AppError::Invalid {
                message: "empty".into()
            }
        );
    }

    #[test]
    fn storage_failures_carry_the_message() {
        let from_port = AppError::from(PortError("disk full".into()));
        assert_eq!(
            from_port,
            AppError::Storage {
                message: "disk full".into()
            }
        );
        assert_eq!(
            AppError::from(CommandError::Storage(PortError("disk full".into()))),
            from_port
        );
        assert_eq!(
            AppError::from(QueryError::Port(PortError("disk full".into()))),
            from_port
        );
    }

    #[test]
    fn focus_errors_keep_their_meaning_and_the_degraded_reason() {
        use application::ports::DegradedReason;
        assert_eq!(
            AppError::from(FocusServiceError::Unavailable(
                DegradedReason::WaylandSession
            )),
            AppError::FocusUnavailable {
                reason: DegradedReasonDto::WaylandSession
            }
        );
        assert!(matches!(
            AppError::from(FocusServiceError::Invalid(
                domain::FocusError::NothingAllowed
            )),
            AppError::Invalid { .. }
        ));
        assert_eq!(
            serde_json::to_string(&AppError::FocusUnavailable {
                reason: DegradedReasonDto::NoDisplay
            })
            .unwrap(),
            r#"{"kind":"focus_unavailable","reason":"no_display"}"#
        );
    }

    #[test]
    fn invalid_range_is_a_validation_error() {
        assert!(matches!(
            AppError::from(QueryError::InvalidRange),
            AppError::Invalid { .. }
        ));
    }

    #[test]
    fn engine_errors_map_to_not_found_storage_or_internal() {
        assert_eq!(
            AppError::from(EngineError::Resolve(ResolveError::Expired)),
            AppError::NotFound
        );
        assert_eq!(
            AppError::from(EngineError::Resolve(ResolveError::NotFound)),
            AppError::NotFound
        );
        assert!(matches!(
            AppError::from(EngineError::Resolve(ResolveError::Storage(PortError(
                "x".into()
            )))),
            AppError::Storage { .. }
        ));
        assert!(matches!(
            AppError::from(EngineError::Stopped),
            AppError::Internal { .. }
        ));
    }

    #[test]
    fn wire_format_is_a_tagged_union() {
        let json = serde_json::to_string(&AppError::ShortcutUnavailable {
            shortcut: "⌃⌥⌘T".into(),
            reason: "in use".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"kind":"shortcut_unavailable","shortcut":"⌃⌥⌘T","reason":"in use"}"#
        );
        assert_eq!(
            serde_json::to_string(&AppError::ConfirmationRequired).unwrap(),
            r#"{"kind":"confirmation_required"}"#
        );
    }
}
