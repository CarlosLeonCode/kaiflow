//! Wire types of the weekly review and the optional AI analysis. API keys have no DTO:
//! they go in through `ai_set_key` and are never sent back.

use application::ai::{AiError, AiSettings, ProviderKind, ReviewOutput, SecretAvailability};
use application::goals::{GoalWeek, GoalWeekPeriod, WeekResult};
use application::ports::{ReviewStatus, StoredReview};
use application::review::{AiSettingsPatch, ProviderPatch, ReviewPreview, WeeklySummary};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::dto::{DashboardDto, FocusSessionDto, GoalDto};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderDto {
    Anthropic,
    Gemini,
    #[serde(rename = "openai")]
    OpenAi,
    Ollama,
}

impl From<ProviderKind> for AiProviderDto {
    fn from(k: ProviderKind) -> Self {
        match k {
            ProviderKind::Anthropic => Self::Anthropic,
            ProviderKind::Gemini => Self::Gemini,
            ProviderKind::OpenAi => Self::OpenAi,
            ProviderKind::Ollama => Self::Ollama,
        }
    }
}

impl From<AiProviderDto> for ProviderKind {
    fn from(k: AiProviderDto) -> Self {
        match k {
            AiProviderDto::Anthropic => Self::Anthropic,
            AiProviderDto::Gemini => Self::Gemini,
            AiProviderDto::OpenAi => Self::OpenAi,
            AiProviderDto::Ollama => Self::Ollama,
        }
    }
}

/// What the settings show about one provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AiProviderInfoDto {
    pub provider: AiProviderDto,
    pub label: String,
    pub needs_key: bool,
    /// Runs on this computer: the data never leaves it.
    pub local: bool,
    pub default_model: String,
    /// The model in use (the user's, else the default). Empty for Ollama until one is chosen.
    pub model: String,
    /// The user switched this provider on.
    pub enabled: bool,
    pub consented_at: Option<i64>,
    /// A key is saved in the keychain. The key itself is never returned.
    pub has_key: bool,
    /// Ollama only.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SecretStoreDto {
    pub available: bool,
    /// Why keys cannot be kept, when `available` is false.
    pub reason: Option<String>,
}

impl From<SecretAvailability> for SecretStoreDto {
    fn from(a: SecretAvailability) -> Self {
        match a {
            SecretAvailability::Available => Self {
                available: true,
                reason: None,
            },
            SecretAvailability::Unavailable(reason) => Self {
                available: false,
                reason: Some(reason),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AiSettingsDto {
    pub selected: AiProviderDto,
    pub include_titles: bool,
    pub monday_review: bool,
    /// Why the last automatic Monday review failed, if it did.
    pub last_auto_error: Option<String>,
    pub providers: Vec<AiProviderInfoDto>,
    pub secret_store: SecretStoreDto,
}

impl AiSettingsDto {
    pub fn new(settings: &AiSettings, secrets: SecretAvailability) -> Self {
        Self {
            selected: settings.selected_kind().into(),
            include_titles: settings.include_titles,
            monday_review: settings.monday_review,
            last_auto_error: settings.last_auto_error.clone(),
            providers: ProviderKind::ALL
                .into_iter()
                .map(|kind| {
                    let own = settings.provider(kind);
                    AiProviderInfoDto {
                        provider: kind.into(),
                        label: kind.label().to_owned(),
                        needs_key: kind.needs_key(),
                        local: kind.is_local(),
                        default_model: kind.default_model().to_owned(),
                        model: settings.model_for(kind),
                        enabled: own.consented_at.is_some(),
                        consented_at: own.consented_at,
                        has_key: !kind.needs_key() || own.key_saved,
                        base_url: settings.base_url_for(kind),
                    }
                })
                .collect(),
            secret_store: secrets.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AiProviderPatchDto {
    pub provider: AiProviderDto,
    /// `true` is the explicit opt-in for this provider.
    pub enabled: Option<bool>,
    /// Empty text goes back to the provider default.
    pub model: Option<String>,
    /// Ollama only; empty goes back to the default address. Must be a localhost address.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AiSettingsPatchDto {
    pub selected: Option<AiProviderDto>,
    pub include_titles: Option<bool>,
    pub monday_review: Option<bool>,
    pub provider: Option<AiProviderPatchDto>,
}

impl From<AiSettingsPatchDto> for AiSettingsPatch {
    fn from(p: AiSettingsPatchDto) -> Self {
        Self {
            selected: p.selected.map(Into::into),
            include_titles: p.include_titles,
            monday_review: p.monday_review,
            provider: p.provider.map(|p| ProviderPatch {
                kind: p.provider.into(),
                enabled: p.enabled,
                model: p.model,
                base_url: p.base_url,
            }),
        }
    }
}

/// Why an AI call failed, so the UI can say something useful.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AiFailureDto {
    Offline,
    Timeout,
    RateLimited,
    Unauthorized,
    RemoteHostRejected,
    Provider,
    BadResponse,
    Cancelled,
}

impl From<&AiError> for AiFailureDto {
    fn from(e: &AiError) -> Self {
        match e {
            AiError::Offline => Self::Offline,
            AiError::Timeout => Self::Timeout,
            AiError::RateLimited { .. } => Self::RateLimited,
            AiError::Unauthorized => Self::Unauthorized,
            AiError::RemoteHostRejected => Self::RemoteHostRejected,
            AiError::Provider { .. } => Self::Provider,
            AiError::BadResponse(_) => Self::BadResponse,
            AiError::Cancelled => Self::Cancelled,
        }
    }
}

// ---- the weekly review ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WeekResultDto {
    Met,
    Missed,
    Inactive,
    InProgress,
}

impl From<WeekResult> for WeekResultDto {
    fn from(r: WeekResult) -> Self {
        match r {
            WeekResult::Met => Self::Met,
            WeekResult::Missed => Self::Missed,
            WeekResult::Inactive => Self::Inactive,
            WeekResult::InProgress => Self::InProgress,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GoalWeekPeriodDto {
    /// Local day number (days since 1970-01-01) of the first day of the period.
    pub start_day: i64,
    pub actual_ms: i64,
    pub result: WeekResultDto,
}

impl From<GoalWeekPeriod> for GoalWeekPeriodDto {
    fn from(p: GoalWeekPeriod) -> Self {
        Self {
            start_day: p.start_day,
            actual_ms: p.actual_ms,
            result: p.result.into(),
        }
    }
}

/// How a goal fared in the reviewed week.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GoalWeekDto {
    pub goal: GoalDto,
    pub periods: Vec<GoalWeekPeriodDto>,
    pub met: u32,
    pub missed: u32,
    pub current_streak: u32,
    pub best_streak: u32,
}

impl From<GoalWeek> for GoalWeekDto {
    fn from(w: GoalWeek) -> Self {
        let (met, missed) = (
            u32::try_from(w.met()).unwrap_or(u32::MAX),
            u32::try_from(w.missed()).unwrap_or(u32::MAX),
        );
        Self {
            goal: w.goal.into(),
            periods: w.periods.into_iter().map(Into::into).collect(),
            met,
            missed,
            current_streak: w.current_streak,
            best_streak: w.best_streak,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatusDto {
    Ok,
    TextFallback,
}

impl From<ReviewStatus> for ReviewStatusDto {
    fn from(s: ReviewStatus) -> Self {
        match s {
            ReviewStatus::Ok => Self::Ok,
            ReviewStatus::TextFallback => Self::TextFallback,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PatternDto {
    pub observation: String,
    pub evidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GoalMissDto {
    pub goal: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SuggestionAiDto {
    pub action: String,
    pub rationale: String,
}

/// The structured answer of a review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ReviewOutputDto {
    pub summary: String,
    pub wins: Vec<String>,
    pub patterns: Vec<PatternDto>,
    pub goal_misses: Vec<GoalMissDto>,
    pub suggestions: Vec<SuggestionAiDto>,
}

impl From<ReviewOutput> for ReviewOutputDto {
    fn from(o: ReviewOutput) -> Self {
        Self {
            summary: o.summary,
            wins: o.wins,
            patterns: o
                .patterns
                .into_iter()
                .map(|p| PatternDto {
                    observation: p.observation,
                    evidence: p.evidence,
                })
                .collect(),
            goal_misses: o
                .goal_misses
                .into_iter()
                .map(|g| GoalMissDto {
                    goal: g.goal,
                    reason: g.reason,
                })
                .collect(),
            suggestions: o
                .suggestions
                .into_iter()
                .map(|s| SuggestionAiDto {
                    action: s.action,
                    rationale: s.rationale,
                })
                .collect(),
        }
    }
}

/// A stored AI review: what was sent and what came back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AiReviewDto {
    pub id: i64,
    pub period_start: i64,
    pub period_end: i64,
    pub period_label: String,
    pub provider: AiProviderDto,
    pub model: String,
    pub included_titles: bool,
    /// The exact data that was sent (JSON text).
    pub request_json: String,
    pub status: ReviewStatusDto,
    /// The structured answer (`status` is `ok`).
    pub output: Option<ReviewOutputDto>,
    /// The plain-text answer (`status` is `text_fallback`).
    pub text: Option<String>,
    pub created_at: i64,
}

impl From<StoredReview> for AiReviewDto {
    fn from(r: StoredReview) -> Self {
        let output: Option<ReviewOutputDto> = (r.status == ReviewStatus::Ok)
            .then(|| serde_json::from_str::<ReviewOutput>(&r.response_json).ok())
            .flatten()
            .map(Into::into);
        // A plain-text answer (or one that no longer parses) is shown as text.
        let text = output.is_none().then(|| {
            serde_json::from_str::<serde_json::Value>(&r.response_json)
                .ok()
                .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(str::to_owned))
                .unwrap_or_else(|| r.response_json.clone())
        });
        Self {
            id: r.id,
            period_start: r.period_start.0,
            period_end: r.period_end.0,
            period_label: r.period_label,
            provider: ProviderKind::parse(&r.provider)
                .unwrap_or(ProviderKind::Anthropic)
                .into(),
            model: r.model,
            included_titles: r.included_titles,
            request_json: r.request_json,
            status: r.status.into(),
            output,
            text,
            created_at: r.created_at.0,
        }
    }
}

/// Everything the Review section shows for a week. Built without any AI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct WeeklyReviewDto {
    pub weeks_ago: u32,
    /// Local day number of the first day of the week.
    pub first_day: i64,
    pub from: i64,
    pub to: i64,
    pub label: String,
    pub dashboard: DashboardDto,
    pub goals: Vec<GoalWeekDto>,
    /// Closed focus sessions that started in the week.
    pub focus: Vec<FocusSessionDto>,
    pub note: String,
    pub reviews: Vec<AiReviewDto>,
}

impl From<WeeklySummary> for WeeklyReviewDto {
    fn from(s: WeeklySummary) -> Self {
        Self {
            weeks_ago: s.weeks_ago,
            first_day: s.first_day,
            from: s.from.0,
            to: s.to.0,
            label: s.label,
            dashboard: DashboardDto::new(s.dashboard, s.goal_statuses),
            goals: s.goals.into_iter().map(Into::into).collect(),
            focus: s.focus.into_iter().map(Into::into).collect(),
            note: s.note,
            reviews: s.reviews.into_iter().map(Into::into).collect(),
        }
    }
}

/// Exactly what a run would send. Nothing has been sent yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ReviewPreviewDto {
    /// Single-use handle `review_run` sends back.
    pub id: String,
    pub provider: AiProviderDto,
    pub model: String,
    pub period_label: String,
    pub included_titles: bool,
    pub title_count: u32,
    /// The instructions part of the request.
    pub system: String,
    /// The data part, byte for byte.
    pub user: String,
    pub bytes: u32,
    /// The model runs on this computer.
    pub local: bool,
}

impl From<ReviewPreview> for ReviewPreviewDto {
    fn from(p: ReviewPreview) -> Self {
        Self {
            id: p.id,
            provider: p.provider.into(),
            model: p.model,
            period_label: p.period_label,
            included_titles: p.included_titles,
            title_count: u32::try_from(p.title_count).unwrap_or(u32::MAX),
            system: p.system,
            user: p.user,
            bytes: u32::try_from(p.bytes).unwrap_or(u32::MAX),
            local: p.local,
        }
    }
}
