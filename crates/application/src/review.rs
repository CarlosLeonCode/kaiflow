//! The weekly review: a summary built locally from the tracked data (always available) and
//! the optional AI analysis on top of it (spec: weekly-review-ai).
//!
//! The AI side is strictly opt-in. Before any provider or keychain port is touched, every
//! entry point checks the per-provider opt-in kept in [`AiSettings`]; without it they return
//! [`ReviewError::NotEnabled`] and the network is never reached. Keys are written through
//! [`ReviewService::set_key`] only and read only by the call that is about to use them.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use domain::calendar::period_start;
use domain::{Period, UtcMs};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::ai::{
    AiConfig, AiError, AiProvider, AiRequest, AiSettings, CancelToken, KEY_AI, MAX_OUTPUT_TOKENS,
    ProviderKind, ReviewOutput, Secret, SecretAvailability, SecretError, SecretStore,
    loopback_target, review_schema, validate_model,
};
use crate::commands::{CONFIRM_TOKEN_TTL_MS, CommandError};
use crate::dashboard::{DASHBOARD_TOP_TITLES, Dashboard};
use crate::goals::{GoalService, GoalStatus, GoalWeek};
use crate::ports::{
    ActivityRepository, AiReviewRepository, Calendar, FocusRepository, PortError, ReportRepository,
    ReviewStatus, SettingsRepository, StoredFocus, StoredReview,
};
use crate::queries::{Queries, QueryError, Range};
use crate::review_payload::{
    MAX_TITLES, PayloadInput, build_payload, clean_language, day_label, serialize_payload,
    system_prompt, user_message,
};
use crate::settings_blobs::{read_blob, read_week_start, write_blob};

/// Key of the [`ReviewNotes`] blob.
pub const KEY_REVIEW_NOTES: &str = "review_notes";
/// Longest personal note on a week.
pub const MAX_NOTE_CHARS: usize = 4000;
/// Notes kept (the oldest weeks fall off first).
const MAX_NOTES: usize = 104;
/// How far back a review may look.
pub const MAX_WEEKS_AGO: u32 = 104;
/// A preview must be run within this time; the data behind it is a snapshot.
pub const PREVIEW_TTL_MS: i64 = 10 * 60_000;
/// Reviews returned by the history list.
pub const HISTORY_LIMIT: u32 = 200;
const MAX_FALLBACK_CHARS: usize = 8000;
const FOCUS_LOOKUP: u32 = 500;
const MIN_KEY_CHARS: usize = 8;
const MAX_KEY_CHARS: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewError {
    /// The provider was not switched on by the user: nothing was sent anywhere.
    NotEnabled,
    /// The provider needs an API key and none is stored.
    KeyMissing,
    /// The OS has no secure store; keys are refused rather than kept less safely.
    SecretStoreUnavailable(String),
    SecretStore(String),
    Ai(AiError),
    Invalid(String),
    /// A destructive operation without a valid, unexpired token.
    ConfirmationRequired,
    NotFound,
    /// Another analysis is already running.
    Busy,
    Storage(PortError),
}

impl fmt::Display for ReviewError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotEnabled => f.write_str(
                "AI analysis is off for this provider. Switch it on in Settings > AI first.",
            ),
            Self::KeyMissing => f.write_str("No API key is saved for this provider."),
            Self::SecretStoreUnavailable(reason) => write!(
                f,
                "There is no secure place to keep API keys on this computer ({reason}). \
Keys are never stored in plain text, so this provider stays off."
            ),
            Self::SecretStore(m) | Self::Invalid(m) => f.write_str(m),
            Self::Ai(e) => e.fmt(f),
            Self::ConfirmationRequired => f.write_str("confirmation required"),
            Self::NotFound => f.write_str("not found"),
            Self::Busy => f.write_str("An analysis is already running."),
            Self::Storage(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for ReviewError {}

impl From<PortError> for ReviewError {
    fn from(e: PortError) -> Self {
        Self::Storage(e)
    }
}

impl From<AiError> for ReviewError {
    fn from(e: AiError) -> Self {
        Self::Ai(e)
    }
}

impl From<CommandError> for ReviewError {
    fn from(e: CommandError) -> Self {
        match e {
            CommandError::Storage(e) => Self::Storage(e),
            CommandError::NotFound => Self::NotFound,
            CommandError::ConfirmationRequired => Self::ConfirmationRequired,
            other => Self::Invalid(other.to_string()),
        }
    }
}

impl From<QueryError> for ReviewError {
    fn from(e: QueryError) -> Self {
        match e {
            QueryError::Port(e) => Self::Storage(e),
            QueryError::InvalidRange => Self::Invalid(e.to_string()),
        }
    }
}

impl From<SecretError> for ReviewError {
    fn from(e: SecretError) -> Self {
        match e {
            SecretError::Unavailable(reason) => Self::SecretStoreUnavailable(reason),
            SecretError::Failed(m) => Self::SecretStore(m),
        }
    }
}

/// Personal notes on reviewed weeks, by the local day number of their first day.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ReviewNotes {
    pub notes: BTreeMap<String, String>,
}

/// Everything the review section shows for a week, built without any AI.
#[derive(Debug, Clone)]
pub struct WeeklySummary {
    pub weeks_ago: u32,
    pub first_day: i64,
    pub from: UtcMs,
    pub to: UtcMs,
    pub label: String,
    pub dashboard: Dashboard,
    pub goals: Vec<GoalWeek>,
    /// Current progress of the goals, as the Overview shows it.
    pub goal_statuses: Vec<GoalStatus>,
    /// Closed focus sessions that started in the week.
    pub focus: Vec<StoredFocus>,
    pub note: String,
    /// Reviews already made for this week, newest first.
    pub reviews: Vec<StoredReview>,
}

/// What a run would send, exactly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewPreview {
    /// Single-use handle the run step sends back.
    pub id: String,
    pub provider: ProviderKind,
    pub model: String,
    pub period_label: String,
    pub included_titles: bool,
    /// Window titles in the payload (0 unless the user opted in).
    pub title_count: usize,
    /// The instructions part of the request.
    pub system: String,
    /// The data part: the user message, byte for byte.
    pub user: String,
    /// The payload JSON inside the user message.
    pub payload_json: String,
    /// Size of what leaves the computer (instructions plus data).
    pub bytes: usize,
    /// The model runs on this computer (the data never leaves it).
    pub local: bool,
}

struct Assembled {
    from: UtcMs,
    to: UtcMs,
    label: String,
    request: AiRequest,
    payload_json: String,
    title_count: usize,
    included_titles: bool,
}

struct PendingPreview {
    id: String,
    issued_at: UtcMs,
    assembled: Assembled,
}

struct PendingDelete {
    token: String,
    issued_at: UtcMs,
}

#[derive(Default)]
struct State {
    preview: Option<PendingPreview>,
    delete_all: Option<PendingDelete>,
    running: Option<CancelToken>,
}

/// Changes to the AI settings. Every field is optional; `None` leaves it as it is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AiSettingsPatch {
    pub selected: Option<ProviderKind>,
    pub include_titles: Option<bool>,
    pub monday_review: Option<bool>,
    pub provider: Option<ProviderPatch>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderPatch {
    pub kind: ProviderKind,
    /// `true` is the explicit opt-in for this provider.
    pub enabled: Option<bool>,
    /// Empty text goes back to the provider default.
    pub model: Option<String>,
    /// Ollama only; empty goes back to the default address.
    pub base_url: Option<String>,
}

/// Outcome of the scheduled Monday review.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MondayReview {
    /// Switched off, nothing to review yet, or already done.
    NotDue,
    Done(StoredReview),
    /// Not retried until the app starts again.
    Failed(String),
}

pub struct ReviewService {
    queries: Queries,
    goals: Arc<GoalService>,
    focus: Arc<dyn FocusRepository>,
    settings: Arc<dyn SettingsRepository>,
    calendar: Arc<dyn Calendar>,
    secrets: Arc<dyn SecretStore>,
    ai: Arc<dyn AiProvider>,
    reviews: Arc<dyn AiReviewRepository>,
    state: Mutex<State>,
    counter: AtomicU64,
}

impl ReviewService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        reports: Arc<dyn ReportRepository>,
        activities: Arc<dyn ActivityRepository>,
        goals: Arc<GoalService>,
        focus: Arc<dyn FocusRepository>,
        settings: Arc<dyn SettingsRepository>,
        calendar: Arc<dyn Calendar>,
        secrets: Arc<dyn SecretStore>,
        ai: Arc<dyn AiProvider>,
        reviews: Arc<dyn AiReviewRepository>,
    ) -> Self {
        Self {
            queries: Queries::new(reports, activities),
            goals,
            focus,
            settings,
            calendar,
            secrets,
            ai,
            reviews,
            state: Mutex::new(State::default()),
            counter: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    // ---- the local summary (no AI, no network) ----

    /// First local day of the week `weeks_ago` weeks before the current one.
    fn week_first_day(&self, weeks_ago: u32, now: UtcMs) -> Result<i64, ReviewError> {
        if weeks_ago > MAX_WEEKS_AGO {
            return Err(ReviewError::Invalid("that week is too far back".into()));
        }
        let week_start = read_week_start(self.settings.as_ref())?;
        let today = self.calendar.local_day(now);
        Ok(period_start(Period::Weekly, today, week_start) - 7 * i64::from(weeks_ago))
    }

    fn week_range(&self, first_day: i64) -> Range {
        Range {
            from: self.calendar.start_of_day(first_day),
            to: self.calendar.start_of_day(first_day + 7),
        }
    }

    fn day_buckets(&self, first_day: i64) -> Vec<Range> {
        (0..7)
            .map(|i| Range {
                from: self.calendar.start_of_day(first_day + i),
                to: self.calendar.start_of_day(first_day + i + 1),
            })
            .collect()
    }

    fn week_label(first_day: i64) -> String {
        format!("{} to {}", day_label(first_day), day_label(first_day + 6))
    }

    fn dashboard_for(
        &self,
        first_day: i64,
        top_titles: usize,
        now: UtcMs,
    ) -> Result<Dashboard, ReviewError> {
        let range = self.week_range(first_day);
        let previous = self.week_range(first_day - 7);
        let buckets = self.day_buckets(first_day);
        Ok(self.queries.dashboard_with_titles(
            range,
            &buckets,
            Some(previous),
            self.calendar.as_ref(),
            now,
            top_titles,
        )?)
    }

    fn focus_in(&self, range: Range) -> Result<Vec<StoredFocus>, ReviewError> {
        let mut sessions: Vec<StoredFocus> = self
            .focus
            .recent(FOCUS_LOOKUP)?
            .into_iter()
            .filter(|s| s.started_at >= range.from && s.started_at < range.to)
            .collect();
        sessions.sort_by_key(|s| s.started_at);
        Ok(sessions)
    }

    /// The weekly summary: activity breakdown, heatmap, goals, focus sessions, the personal
    /// note and the reviews already made. Never reaches a provider or the keychain.
    pub fn summary(&self, weeks_ago: u32, now: UtcMs) -> Result<WeeklySummary, ReviewError> {
        let first_day = self.week_first_day(weeks_ago, now)?;
        let range = self.week_range(first_day);
        Ok(WeeklySummary {
            weeks_ago,
            first_day,
            from: range.from,
            to: range.to,
            label: Self::week_label(first_day),
            dashboard: self.dashboard_for(first_day, DASHBOARD_TOP_TITLES, now)?,
            goals: self.goals.week_outcomes(first_day, now)?,
            goal_statuses: self.goals.statuses(now)?,
            focus: self.focus_in(range)?,
            note: self.note(first_day)?,
            reviews: self.reviews.for_period(range.from)?,
        })
    }

    pub fn note(&self, first_day: i64) -> Result<String, ReviewError> {
        let notes: ReviewNotes = read_blob(self.settings.as_ref(), KEY_REVIEW_NOTES)?;
        Ok(notes
            .notes
            .get(&first_day.to_string())
            .cloned()
            .unwrap_or_default())
    }

    /// Saves (or, with blank text, removes) the personal note of a week.
    pub fn set_note(&self, first_day: i64, note: &str) -> Result<(), ReviewError> {
        let note = note.trim();
        if note.chars().count() > MAX_NOTE_CHARS {
            return Err(ReviewError::Invalid(format!(
                "a note can have at most {MAX_NOTE_CHARS} characters"
            )));
        }
        let mut notes: ReviewNotes = read_blob(self.settings.as_ref(), KEY_REVIEW_NOTES)?;
        let key = first_day.to_string();
        if note.is_empty() {
            notes.notes.remove(&key);
        } else {
            notes.notes.insert(key, note.to_owned());
        }
        // Oldest weeks first (keys are day numbers of similar width).
        while notes.notes.len() > MAX_NOTES {
            let oldest = notes
                .notes
                .keys()
                .min_by_key(|k| k.parse::<i64>().unwrap_or(i64::MAX))
                .cloned();
            match oldest {
                Some(k) => notes.notes.remove(&k),
                None => break,
            };
        }
        Ok(write_blob(
            self.settings.as_ref(),
            KEY_REVIEW_NOTES,
            &notes,
        )?)
    }

    // ---- settings and keys ----

    pub fn settings(&self) -> Result<AiSettings, ReviewError> {
        Ok(read_blob(self.settings.as_ref(), KEY_AI)?)
    }

    pub fn secret_availability(&self) -> SecretAvailability {
        self.secrets.availability()
    }

    /// Applies a patch. Switching a provider on is the explicit opt-in: it needs a secure
    /// place for its key (unless it is Ollama) and a valid address (Ollama).
    pub fn update_settings(
        &self,
        patch: &AiSettingsPatch,
        now: UtcMs,
    ) -> Result<AiSettings, ReviewError> {
        let mut settings = self.settings()?;
        if let Some(kind) = patch.selected {
            settings.selected = Some(kind.as_str().to_owned());
        }
        if let Some(v) = patch.include_titles {
            settings.include_titles = v;
        }
        if let Some(v) = patch.monday_review {
            settings.monday_review = v;
        }
        if let Some(p) = &patch.provider {
            let kind = p.kind;
            if let Some(model) = &p.model {
                let model = validate_model(model).map_err(ReviewError::Invalid)?;
                settings.provider_mut(kind).model = (!model.is_empty()).then_some(model);
            }
            if let Some(url) = &p.base_url {
                if !kind.is_local() {
                    return Err(ReviewError::Invalid(
                        "only Ollama has an address to set".into(),
                    ));
                }
                let url = url.trim();
                if url.is_empty() {
                    settings.provider_mut(kind).base_url = None;
                } else {
                    loopback_target(url)?;
                    settings.provider_mut(kind).base_url = Some(url.to_owned());
                }
            }
            match p.enabled {
                Some(true) => {
                    if kind.needs_key()
                        && let SecretAvailability::Unavailable(reason) = self.secrets.availability()
                    {
                        return Err(ReviewError::SecretStoreUnavailable(reason));
                    }
                    if kind.is_local() {
                        loopback_target(&settings.base_url_for(kind).unwrap_or_default())?;
                    }
                    let entry = settings.provider_mut(kind);
                    entry.consented_at.get_or_insert(now.0);
                }
                Some(false) => settings.provider_mut(kind).consented_at = None,
                None => {}
            }
        }
        write_blob(self.settings.as_ref(), KEY_AI, &settings)?;
        Ok(settings)
    }

    /// Stores an API key in the OS keychain. The only way a key enters the app; it is never
    /// returned by any call. Refused when the OS has no secure store.
    pub fn set_key(&self, kind: ProviderKind, key: &str) -> Result<(), ReviewError> {
        if !kind.needs_key() {
            return Err(ReviewError::Invalid(format!(
                "{} does not use an API key",
                kind.label()
            )));
        }
        let key = key.trim();
        let chars = key.chars().count();
        if !(MIN_KEY_CHARS..=MAX_KEY_CHARS).contains(&chars)
            || key.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err(ReviewError::Invalid(
                "that does not look like an API key (no spaces, 8 to 512 characters)".into(),
            ));
        }
        if let SecretAvailability::Unavailable(reason) = self.secrets.availability() {
            return Err(ReviewError::SecretStoreUnavailable(reason));
        }
        self.secrets.set(kind, &Secret::new(key))?;
        let mut settings = self.settings()?;
        settings.provider_mut(kind).key_saved = true;
        write_blob(self.settings.as_ref(), KEY_AI, &settings)?;
        Ok(())
    }

    pub fn delete_key(&self, kind: ProviderKind) -> Result<(), ReviewError> {
        if kind.needs_key() {
            self.secrets.delete(kind)?;
        }
        let mut settings = self.settings()?;
        settings.provider_mut(kind).key_saved = false;
        // Without its key a provider cannot work; switch it off so nothing half-works.
        settings.provider_mut(kind).consented_at = None;
        write_blob(self.settings.as_ref(), KEY_AI, &settings)?;
        Ok(())
    }

    /// Whether a key was saved. Answered from the settings, not from the keychain, so
    /// opening the panel never makes the OS ask for access.
    pub fn has_key(&self, kind: ProviderKind) -> Result<bool, ReviewError> {
        Ok(!kind.needs_key() || self.settings()?.provider(kind).key_saved)
    }

    // ---- guards ----

    /// The opt-in gate every network-capable entry point goes through first.
    fn ready(&self, kind: ProviderKind) -> Result<AiSettings, ReviewError> {
        let settings = self.settings()?;
        if !settings.is_enabled(kind) {
            return Err(ReviewError::NotEnabled);
        }
        if kind.is_local() {
            loopback_target(&settings.base_url_for(kind).unwrap_or_default())?;
        }
        Ok(settings)
    }

    fn key_for(&self, kind: ProviderKind) -> Result<Option<Secret>, ReviewError> {
        if !kind.needs_key() {
            return Ok(None);
        }
        match self.secrets.get(kind)? {
            Some(key) => Ok(Some(key)),
            None => {
                // The marker was stale (the entry was removed outside the app).
                if let Ok(mut settings) = self.settings() {
                    settings.provider_mut(kind).key_saved = false;
                    let _ = write_blob(self.settings.as_ref(), KEY_AI, &settings);
                }
                Err(ReviewError::KeyMissing)
            }
        }
    }

    /// Runs `job` with a cancel token registered, so `cancel` can interrupt it.
    fn cancellable<T>(
        &self,
        job: impl FnOnce(&CancelToken) -> Result<T, AiError>,
    ) -> Result<T, ReviewError> {
        let token = CancelToken::default();
        {
            let mut state = self.lock();
            if state.running.is_some() {
                return Err(ReviewError::Busy);
            }
            state.running = Some(token.clone());
        }
        let outcome = job(&token);
        self.lock().running = None;
        Ok(outcome?)
    }

    /// Asks the running analysis to stop; the command waiting for it returns at once.
    pub fn cancel(&self) {
        if let Some(token) = &self.lock().running {
            token.cancel();
        }
    }

    // ---- models and test ----

    /// Model ids the account can use. `NotEnabled` (no traffic) before the opt-in.
    pub fn models(&self, kind: ProviderKind) -> Result<Vec<String>, ReviewError> {
        let settings = self.ready(kind)?;
        let key = self.key_for(kind)?;
        let config = settings.config_for(kind);
        self.cancellable(|cancel| self.ai.list_models(&config, key.as_ref(), cancel))
    }

    /// Checks the key and the connection by listing models; returns how many were found.
    pub fn test(&self, kind: ProviderKind) -> Result<usize, ReviewError> {
        self.models(kind).map(|models| models.len())
    }

    // ---- preview and run ----

    fn assemble(
        &self,
        settings: &AiSettings,
        kind: ProviderKind,
        weeks_ago: u32,
        include_titles: bool,
        language: &str,
        now: UtcMs,
    ) -> Result<Assembled, ReviewError> {
        let config = settings.config_for(kind);
        if config.model.trim().is_empty() {
            return Err(ReviewError::Invalid(
                "Choose a model first (the list comes from Ollama's installed models).".into(),
            ));
        }
        let first_day = self.week_first_day(weeks_ago, now)?;
        let range = self.week_range(first_day);
        let top_titles = if include_titles { MAX_TITLES } else { 0 };
        let dashboard = self.dashboard_for(first_day, top_titles, now)?;
        let goals = self.goals.week_outcomes(first_day, now)?;
        let focus = self.focus_in(range)?;
        let payload = build_payload(&PayloadInput {
            dashboard: &dashboard,
            first_day,
            goals: &goals,
            focus: &focus,
            include_titles,
        });
        let title_count = payload["window_titles"].as_array().map_or(0, Vec::len);
        let payload_json = serialize_payload(&payload);
        Ok(Assembled {
            from: range.from,
            to: range.to,
            label: Self::week_label(first_day),
            request: AiRequest {
                config,
                system: system_prompt(language),
                user: user_message(&payload_json),
                schema: review_schema(),
                max_output_tokens: MAX_OUTPUT_TOKENS,
            },
            payload_json,
            title_count,
            included_titles: include_titles,
        })
    }

    /// Builds the exact request a run would send and keeps it for [`Self::run`]. Nothing is
    /// sent. `NotEnabled` (no traffic) before the opt-in.
    pub fn preview(
        &self,
        weeks_ago: u32,
        include_titles: bool,
        language: &str,
        now: UtcMs,
    ) -> Result<ReviewPreview, ReviewError> {
        let settings = self.settings()?;
        let kind = settings.selected_kind();
        self.ready(kind)?;
        let assembled = self.assemble(
            &settings,
            kind,
            weeks_ago,
            include_titles,
            &clean_language(language),
            now,
        )?;
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let id = format!("{:x}-p{n:x}", now.0);
        let preview = ReviewPreview {
            id: id.clone(),
            provider: kind,
            model: assembled.request.config.model.clone(),
            period_label: assembled.label.clone(),
            included_titles: assembled.included_titles,
            title_count: assembled.title_count,
            system: assembled.request.system.clone(),
            user: assembled.request.user.clone(),
            payload_json: assembled.payload_json.clone(),
            bytes: assembled.request.system.len() + assembled.request.user.len(),
            local: kind.is_local(),
        };
        self.lock().preview = Some(PendingPreview {
            id,
            issued_at: now,
            assembled,
        });
        Ok(preview)
    }

    /// Sends a previewed request. The preview is single use and expires after ten minutes.
    /// A failed call stores nothing.
    pub fn run(&self, preview_id: &str, now: UtcMs) -> Result<StoredReview, ReviewError> {
        let pending = {
            let mut state = self.lock();
            match state.preview.take() {
                Some(p) if p.id == preview_id => p,
                other => {
                    state.preview = other;
                    return Err(ReviewError::NotFound);
                }
            }
        };
        if !(0..=PREVIEW_TTL_MS).contains(&now.since(pending.issued_at)) {
            return Err(ReviewError::NotFound);
        }
        self.send(pending.assembled, now)
    }

    fn send(&self, assembled: Assembled, now: UtcMs) -> Result<StoredReview, ReviewError> {
        let kind = assembled.request.config.provider;
        self.ready(kind)?;
        let key = self.key_for(kind)?;
        let text =
            self.cancellable(|cancel| self.ai.complete(&assembled.request, key.as_ref(), cancel))?;
        let text = text.trim();
        if text.is_empty() {
            return Err(ReviewError::Ai(AiError::BadResponse(
                "the provider sent an empty answer".into(),
            )));
        }
        let (status, response_json) = match ReviewOutput::parse(text) {
            Some(output) => (
                ReviewStatus::Ok,
                serde_json::to_string(&output).unwrap_or_default(),
            ),
            None => (
                ReviewStatus::TextFallback,
                json!({ "text": clip(text, MAX_FALLBACK_CHARS) }).to_string(),
            ),
        };
        Ok(self.reviews.insert(&StoredReview {
            id: 0,
            period_start: assembled.from,
            period_end: assembled.to,
            period_label: assembled.label,
            provider: kind.as_str().to_owned(),
            model: assembled.request.config.model,
            included_titles: assembled.included_titles,
            request_json: assembled.payload_json,
            response_json,
            status,
            created_at: now,
        })?)
    }

    // ---- history ----

    pub fn history(&self) -> Result<Vec<StoredReview>, ReviewError> {
        Ok(self.reviews.list(HISTORY_LIMIT)?)
    }

    pub fn delete(&self, id: i64) -> Result<(), ReviewError> {
        if self.reviews.delete(id)? {
            Ok(())
        } else {
            Err(ReviewError::NotFound)
        }
    }

    /// Step one of "delete all": the token the confirmation must send back within a minute.
    pub fn prepare_delete_all(&self, now: UtcMs) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let token = format!("{:x}-d{n:x}", now.0);
        self.lock().delete_all = Some(PendingDelete {
            token: token.clone(),
            issued_at: now,
        });
        token
    }

    /// Step two: deletes every review; returns how many.
    pub fn delete_all(&self, token: &str, now: UtcMs) -> Result<usize, ReviewError> {
        {
            let mut state = self.lock();
            match state.delete_all.take() {
                Some(p) if p.token == token => {
                    if !(0..=CONFIRM_TOKEN_TTL_MS).contains(&now.since(p.issued_at)) {
                        return Err(ReviewError::ConfirmationRequired);
                    }
                }
                other => {
                    // A wrong token must not cancel the confirmation that is still valid.
                    state.delete_all = other;
                    return Err(ReviewError::ConfirmationRequired);
                }
            }
        }
        Ok(self.reviews.delete_all()?)
    }

    // ---- the Monday review ----

    /// The scheduled review: when the user switched it on, the selected provider is enabled
    /// and the previous week has no review yet, analyses that week with the saved settings
    /// (titles only if the user opted in for them). Failures are recorded and not retried
    /// until the next launch; nothing here runs unless the user enabled it.
    pub fn run_monday_review(&self, language: &str, now: UtcMs) -> MondayReview {
        let outcome = self.try_monday_review(language, now);
        match outcome {
            Ok(None) => MondayReview::NotDue,
            Ok(Some(review)) => MondayReview::Done(review),
            Err(error) => {
                let message = error.to_string();
                if let Ok(mut settings) = self.settings() {
                    settings.last_auto_error = Some(message.clone());
                    let _ = write_blob(self.settings.as_ref(), KEY_AI, &settings);
                }
                MondayReview::Failed(message)
            }
        }
    }

    fn try_monday_review(
        &self,
        language: &str,
        now: UtcMs,
    ) -> Result<Option<StoredReview>, ReviewError> {
        let settings = self.settings()?;
        let kind = settings.selected_kind();
        if !settings.monday_review || !settings.is_enabled(kind) {
            return Ok(None);
        }
        let first_day = self.week_first_day(1, now)?;
        let range = self.week_range(first_day);
        if settings.last_auto_week_day == Some(first_day)
            || !self.reviews.for_period(range.from)?.is_empty()
        {
            return Ok(None);
        }
        let assembled = self.assemble(
            &settings,
            kind,
            1,
            settings.include_titles,
            &clean_language(language),
            now,
        )?;
        let review = self.send(assembled, now)?;
        let mut settings = self.settings()?;
        settings.last_auto_week_day = Some(first_day);
        settings.last_auto_error = None;
        write_blob(self.settings.as_ref(), KEY_AI, &settings)?;
        Ok(Some(review))
    }
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_owned()
    } else {
        text.chars().take(max).collect()
    }
}

/// The config a provider would use right now (for tests and the status view).
pub fn config_of(settings: &AiSettings) -> AiConfig {
    settings.config_for(settings.selected_kind())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::{
        FakeActivities, FakeAi, FakeFocus, FakeGoals, FakeReviews, FakeSecrets, FakeSettings,
        FakeStore, FixedCalendar,
    };
    use domain::{EndReason, Segment, SegmentId, SegmentSource};

    const DAY: i64 = 86_400_000;
    // Monday 2026-10-12 is local day 20738 (UTC calendar in these tests).
    const MONDAY: i64 = 20_738;
    // Wednesday of that week, noon.
    const NOW: i64 = (MONDAY + 2) * DAY + 12 * 3_600_000;

    struct Rig {
        service: ReviewService,
        ai: FakeAi,
        secrets: FakeSecrets,
        settings: FakeSettings,
        reviews: FakeReviews,
        store: FakeStore,
    }

    fn rig_with(secrets: FakeSecrets) -> Rig {
        let store = FakeStore::default();
        let settings = FakeSettings::default();
        let activities = FakeActivities::default();
        let goals_repo = FakeGoals::default();
        let focus = FakeFocus::default();
        let calendar = Arc::new(FixedCalendar::fixed(0));
        let goals = Arc::new(GoalService::new(
            Arc::new(goals_repo),
            Arc::new(store.clone()),
            Arc::new(activities.clone()),
            Arc::new(settings.clone()),
            calendar.clone(),
        ));
        let ai = FakeAi::default();
        let reviews = FakeReviews::default();
        let service = ReviewService::new(
            Arc::new(store.clone()),
            Arc::new(activities),
            goals,
            Arc::new(focus),
            Arc::new(settings.clone()),
            calendar,
            Arc::new(secrets.clone()),
            Arc::new(ai.clone()),
            Arc::new(reviews.clone()),
        );
        Rig {
            service,
            ai,
            secrets,
            settings,
            reviews,
            store,
        }
    }

    fn rig() -> Rig {
        rig_with(FakeSecrets::default())
    }

    fn spend(store: &FakeStore, title: &str, start: i64, end: i64) {
        store.seed_segment(Segment {
            id: SegmentId(0),
            started_at: UtcMs(start),
            ended_at: Some(UtcMs(end)),
            heartbeat_at: UtcMs(end),
            app_id: Some("com.browser".into()),
            app_name: Some("Browser".into()),
            window_title: Some(title.into()),
            end_reason: Some(EndReason::FocusChange),
            source: SegmentSource::Tracked,
            activity_id: None,
        });
    }

    fn patch(kind: ProviderKind, enabled: bool) -> AiSettingsPatch {
        AiSettingsPatch {
            selected: Some(kind),
            provider: Some(ProviderPatch {
                kind,
                enabled: Some(enabled),
                model: None,
                base_url: None,
            }),
            ..AiSettingsPatch::default()
        }
    }

    /// Anthropic switched on with a key saved.
    fn enabled(r: &Rig) {
        r.service
            .set_key(ProviderKind::Anthropic, "sk-ant-test-key")
            .unwrap();
        r.service
            .update_settings(&patch(ProviderKind::Anthropic, true), UtcMs(NOW))
            .unwrap();
    }

    const GOOD_ANSWER: &str = r#"{"summary":"A steady week.","wins":["Focused mornings"],
        "patterns":[{"observation":"Late browsing","evidence":"90 min after 22:00"}],
        "goal_misses":[],"suggestions":[{"action":"Close the browser at 21:00","rationale":"Late use"}]}"#;

    #[test]
    fn nothing_reaches_a_provider_or_the_keychain_before_the_opt_in() {
        let r = rig();
        spend(&r.store, "Docs", MONDAY * DAY, MONDAY * DAY + 3_600_000);
        // A key can sit in the keychain without the provider being switched on.
        r.service
            .set_key(ProviderKind::Anthropic, "sk-ant-test-key")
            .unwrap();
        let touched_after_set = r.secrets.touched();

        assert_eq!(
            r.service.models(ProviderKind::Anthropic),
            Err(ReviewError::NotEnabled)
        );
        assert_eq!(
            r.service.preview(0, false, "English", UtcMs(NOW)),
            Err(ReviewError::NotEnabled)
        );
        assert_eq!(
            r.service.run("anything", UtcMs(NOW)),
            Err(ReviewError::NotFound)
        );
        assert_eq!(
            r.service.test(ProviderKind::Anthropic),
            Err(ReviewError::NotEnabled)
        );
        assert_eq!(r.ai.traffic(), 0, "no network");
        assert_eq!(r.secrets.touched(), touched_after_set, "no key was read");
        // Opening the review never needs the AI.
        let summary = r.service.summary(0, UtcMs(NOW)).unwrap();
        assert_eq!(summary.label, "2026-10-12 to 2026-10-18");
        assert_eq!(summary.dashboard.total_ms, 3_600_000);
        assert_eq!(r.ai.traffic(), 0);
    }

    #[test]
    fn the_opt_in_is_per_provider() {
        let r = rig();
        enabled(&r);
        // Gemini was not switched on: selecting it still sends nothing.
        r.service
            .update_settings(
                &AiSettingsPatch {
                    selected: Some(ProviderKind::Gemini),
                    ..AiSettingsPatch::default()
                },
                UtcMs(NOW),
            )
            .unwrap();
        assert_eq!(
            r.service.preview(0, false, "English", UtcMs(NOW)),
            Err(ReviewError::NotEnabled)
        );
        assert_eq!(r.ai.traffic(), 0);
        // Switching Anthropic off again closes it.
        r.service
            .update_settings(&patch(ProviderKind::Anthropic, false), UtcMs(NOW))
            .unwrap();
        assert_eq!(
            r.service.models(ProviderKind::Anthropic),
            Err(ReviewError::NotEnabled)
        );
    }

    #[test]
    fn preview_shows_the_exact_request_and_run_sends_that_and_saves_it() {
        let r = rig();
        enabled(&r);
        spend(
            &r.store,
            "Quarterly plan",
            MONDAY * DAY,
            MONDAY * DAY + 1_800_000,
        );
        r.ai.answer_with(Ok(GOOD_ANSWER.into()));

        let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
        assert_eq!(preview.provider, ProviderKind::Anthropic);
        assert_eq!(preview.model, "claude-haiku-5-5");
        assert!(!preview.included_titles && preview.title_count == 0);
        assert!(
            !preview.user.contains("Quarterly plan"),
            "titles are opt-in"
        );
        assert!(
            preview
                .user
                .starts_with("Here is the week to review.\n<data>")
        );
        assert_eq!(r.ai.traffic(), 0, "previewing sends nothing");

        let review = r.service.run(&preview.id, UtcMs(NOW)).unwrap();
        assert_eq!(review.status, ReviewStatus::Ok);
        assert_eq!(review.provider, "anthropic");
        assert_eq!(review.request_json, preview.payload_json);
        assert!(review.response_json.contains("A steady week."));
        assert_eq!(r.reviews.all().len(), 1);

        let calls = r.ai.calls();
        assert_eq!(calls.len(), 1);
        let sent = calls[0].request.as_ref().unwrap();
        assert_eq!(sent.system, preview.system);
        assert_eq!(sent.user, preview.user, "what was shown is what was sent");
        assert!(calls[0].had_key);
        assert_eq!(sent.config.model, "claude-haiku-5-5");

        // The preview is single use.
        assert_eq!(
            r.service.run(&preview.id, UtcMs(NOW)),
            Err(ReviewError::NotFound)
        );
    }

    #[test]
    fn titles_are_sent_only_when_asked_and_the_preview_says_so() {
        let r = rig();
        enabled(&r);
        spend(
            &r.store,
            "Quarterly plan",
            MONDAY * DAY,
            MONDAY * DAY + 1_800_000,
        );
        let preview = r.service.preview(0, true, "English", UtcMs(NOW)).unwrap();
        assert!(preview.included_titles);
        assert_eq!(preview.title_count, 1);
        assert!(preview.user.contains("Quarterly plan"));
        assert_eq!(preview.bytes, preview.system.len() + preview.user.len());
    }

    #[test]
    fn an_old_preview_cannot_be_run() {
        let r = rig();
        enabled(&r);
        let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
        assert_eq!(
            r.service.run(&preview.id, UtcMs(NOW + PREVIEW_TTL_MS + 1)),
            Err(ReviewError::NotFound)
        );
        assert_eq!(r.ai.traffic(), 0);
    }

    #[test]
    fn a_plain_text_answer_is_kept_as_a_fallback() {
        let r = rig();
        enabled(&r);
        r.ai.answer_with(Ok("You spent most of the week writing.".into()));
        let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
        let review = r.service.run(&preview.id, UtcMs(NOW)).unwrap();
        assert_eq!(review.status, ReviewStatus::TextFallback);
        let stored: serde_json::Value = serde_json::from_str(&review.response_json).unwrap();
        assert_eq!(stored["text"], "You spent most of the week writing.");
    }

    #[test]
    fn a_failed_call_saves_nothing_and_reports_the_reason() {
        let r = rig();
        enabled(&r);
        for error in [
            AiError::Timeout,
            AiError::Offline,
            AiError::RateLimited {
                retry_after_secs: Some(30),
            },
            AiError::Unauthorized,
        ] {
            r.ai.answer_with(Err(error.clone()));
            let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
            assert_eq!(
                r.service.run(&preview.id, UtcMs(NOW)),
                Err(ReviewError::Ai(error))
            );
        }
        assert!(r.reviews.all().is_empty(), "no partial review");
        // And an empty answer is not a review either.
        r.ai.answer_with(Ok("  ".into()));
        let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
        assert!(matches!(
            r.service.run(&preview.id, UtcMs(NOW)),
            Err(ReviewError::Ai(AiError::BadResponse(_)))
        ));
        assert!(r.reviews.all().is_empty());
    }

    #[test]
    fn a_missing_key_is_reported_and_the_marker_corrected() {
        let r = rig();
        enabled(&r);
        assert!(r.service.has_key(ProviderKind::Anthropic).unwrap());
        // The entry disappeared from the keychain behind the app's back.
        r.secrets.clear();
        let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
        assert_eq!(
            r.service.run(&preview.id, UtcMs(NOW)),
            Err(ReviewError::KeyMissing)
        );
        assert!(!r.service.has_key(ProviderKind::Anthropic).unwrap());
        assert_eq!(r.ai.traffic(), 0);
    }

    #[test]
    fn keys_are_stored_only_in_the_keychain_and_never_in_settings() {
        let r = rig();
        r.service
            .set_key(ProviderKind::OpenAi, "sk-openai-secret-123")
            .unwrap();
        assert_eq!(
            r.secrets.stored(ProviderKind::OpenAi).as_deref(),
            Some("sk-openai-secret-123")
        );
        let blob = r.settings.get(KEY_AI).unwrap().unwrap();
        assert!(!blob.contains("sk-openai-secret-123"));
        assert!(r.service.has_key(ProviderKind::OpenAi).unwrap());
        for bad in ["", "short", "has space in it 12345", "line\nbreak12345"] {
            assert!(
                matches!(
                    r.service.set_key(ProviderKind::OpenAi, bad),
                    Err(ReviewError::Invalid(_))
                ),
                "{bad:?}"
            );
        }
        assert!(matches!(
            r.service.set_key(ProviderKind::Ollama, "whatever-key-1"),
            Err(ReviewError::Invalid(_))
        ));
        // Deleting the key also switches the provider off.
        r.service
            .update_settings(&patch(ProviderKind::OpenAi, true), UtcMs(NOW))
            .unwrap();
        r.service.delete_key(ProviderKind::OpenAi).unwrap();
        assert!(r.secrets.stored(ProviderKind::OpenAi).is_none());
        assert!(
            !r.service
                .settings()
                .unwrap()
                .is_enabled(ProviderKind::OpenAi)
        );
    }

    #[test]
    fn without_a_secure_store_keys_are_refused_and_nothing_is_written_anywhere() {
        let r = rig_with(FakeSecrets::unavailable("no Secret Service on this system"));
        let refused = r
            .service
            .set_key(ProviderKind::Anthropic, "sk-ant-test-key")
            .unwrap_err();
        assert!(matches!(refused, ReviewError::SecretStoreUnavailable(_)));
        assert!(refused.to_string().contains("never stored in plain text"));
        assert!(r.secrets.stored(ProviderKind::Anthropic).is_none());
        assert!(
            r.settings.get(KEY_AI).unwrap().is_none(),
            "no fallback copy in the settings"
        );
        // The provider cannot be switched on either; Ollama (no key) still can.
        assert!(matches!(
            r.service
                .update_settings(&patch(ProviderKind::Anthropic, true), UtcMs(NOW)),
            Err(ReviewError::SecretStoreUnavailable(_))
        ));
        r.service
            .update_settings(&patch(ProviderKind::Ollama, true), UtcMs(NOW))
            .unwrap();
        assert!(
            r.service
                .settings()
                .unwrap()
                .is_enabled(ProviderKind::Ollama)
        );
    }

    #[test]
    fn ollama_rejects_remote_addresses_before_any_request() {
        let r = rig();
        for url in [
            "http://example.com:11434",
            "https://example.com",
            "http://192.168.1.5:11434",
        ] {
            let result = r.service.update_settings(
                &AiSettingsPatch {
                    provider: Some(ProviderPatch {
                        kind: ProviderKind::Ollama,
                        enabled: None,
                        model: None,
                        base_url: Some(url.into()),
                    }),
                    ..AiSettingsPatch::default()
                },
                UtcMs(NOW),
            );
            assert_eq!(
                result,
                Err(ReviewError::Ai(AiError::RemoteHostRejected)),
                "{url}"
            );
        }
        // A remote address that got into the stored settings (hand edit) is still caught.
        r.settings
            .set(
                KEY_AI,
                r#"{"selected":"ollama","providers":{"ollama":{"consented_at":1,"model":"llama","base_url":"https://example.com"}}}"#,
            )
            .unwrap();
        assert_eq!(
            r.service.preview(0, false, "English", UtcMs(NOW)),
            Err(ReviewError::Ai(AiError::RemoteHostRejected))
        );
        assert_eq!(
            r.service.models(ProviderKind::Ollama),
            Err(ReviewError::Ai(AiError::RemoteHostRejected))
        );
        assert_eq!(r.ai.traffic(), 0);
    }

    #[test]
    fn ollama_runs_without_a_key_once_a_model_is_chosen() {
        let r = rig();
        r.service
            .update_settings(&patch(ProviderKind::Ollama, true), UtcMs(NOW))
            .unwrap();
        // No installed model chosen yet.
        assert!(matches!(
            r.service.preview(0, false, "English", UtcMs(NOW)),
            Err(ReviewError::Invalid(_))
        ));
        r.service
            .update_settings(
                &AiSettingsPatch {
                    provider: Some(ProviderPatch {
                        kind: ProviderKind::Ollama,
                        enabled: None,
                        model: Some("llama3.2".into()),
                        base_url: Some("http://127.0.0.1:11434".into()),
                    }),
                    ..AiSettingsPatch::default()
                },
                UtcMs(NOW),
            )
            .unwrap();
        r.ai.answer_with(Ok(GOOD_ANSWER.into()));
        let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
        assert!(preview.local);
        r.service.run(&preview.id, UtcMs(NOW)).unwrap();
        let call = &r.ai.calls()[0];
        assert!(!call.had_key);
        assert_eq!(
            call.config.base_url.as_deref(),
            Some("http://127.0.0.1:11434")
        );
        assert_eq!(r.secrets.touched(), 0, "Ollama never touches the keychain");
    }

    #[test]
    fn models_come_from_the_provider_once_enabled() {
        let r = rig();
        enabled(&r);
        r.ai.list_with(Ok(vec![
            "claude-haiku-5-5".into(),
            "claude-opus-5-5".into(),
        ]));
        assert_eq!(r.service.models(ProviderKind::Anthropic).unwrap().len(), 2);
        assert_eq!(r.service.test(ProviderKind::Anthropic).unwrap(), 2);
    }

    #[test]
    fn history_delete_one_and_delete_all_with_a_token() {
        let r = rig();
        enabled(&r);
        r.ai.answer_with(Ok(GOOD_ANSWER.into()));
        for i in 0..3 {
            let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
            r.service.run(&preview.id, UtcMs(NOW + i)).unwrap();
        }
        let history = r.service.history().unwrap();
        assert_eq!(history.len(), 3);
        assert!(
            history[0].created_at >= history[2].created_at,
            "newest first"
        );

        r.service.delete(history[0].id).unwrap();
        assert_eq!(r.service.history().unwrap().len(), 2);
        assert_eq!(r.service.delete(history[0].id), Err(ReviewError::NotFound));

        // Without the token nothing is deleted.
        assert_eq!(
            r.service.delete_all("forged", UtcMs(NOW)),
            Err(ReviewError::ConfirmationRequired)
        );
        let token = r.service.prepare_delete_all(UtcMs(NOW));
        assert_eq!(
            r.service.delete_all("forged", UtcMs(NOW)),
            Err(ReviewError::ConfirmationRequired)
        );
        assert_eq!(r.service.history().unwrap().len(), 2);
        assert_eq!(r.service.delete_all(&token, UtcMs(NOW)).unwrap(), 2);
        assert!(r.service.history().unwrap().is_empty());
        // Single use, and it expires.
        assert_eq!(
            r.service.delete_all(&token, UtcMs(NOW)),
            Err(ReviewError::ConfirmationRequired)
        );
        let late = r.service.prepare_delete_all(UtcMs(NOW));
        assert_eq!(
            r.service
                .delete_all(&late, UtcMs(NOW + CONFIRM_TOKEN_TTL_MS + 1)),
            Err(ReviewError::ConfirmationRequired)
        );
    }

    #[test]
    fn the_monday_review_runs_only_when_enabled_and_once_per_week() {
        let r = rig();
        enabled(&r);
        r.ai.answer_with(Ok(GOOD_ANSWER.into()));
        let monday_noon = (MONDAY + 7) * DAY + 12 * 3_600_000;

        // Not switched on: nothing happens.
        assert_eq!(
            r.service.run_monday_review("English", UtcMs(monday_noon)),
            MondayReview::NotDue
        );
        assert_eq!(
            r.ai.traffic(),
            0,
            "no automatic calls unless the user enables it"
        );

        r.service
            .update_settings(
                &AiSettingsPatch {
                    monday_review: Some(true),
                    ..AiSettingsPatch::default()
                },
                UtcMs(NOW),
            )
            .unwrap();
        let outcome = r.service.run_monday_review("English", UtcMs(monday_noon));
        let MondayReview::Done(review) = outcome else {
            panic!("expected a review, got {outcome:?}");
        };
        assert_eq!(review.period_label, "2026-10-12 to 2026-10-18");
        assert_eq!(r.ai.traffic(), 1);
        assert_eq!(
            r.service
                .run_monday_review("English", UtcMs(monday_noon + 1000)),
            MondayReview::NotDue,
            "the same week is not reviewed twice"
        );
        assert_eq!(r.ai.traffic(), 1);
    }

    #[test]
    fn an_offline_monday_review_records_the_failure_and_leaves_the_week_for_the_next_launch() {
        let r = rig();
        enabled(&r);
        r.service
            .update_settings(
                &AiSettingsPatch {
                    monday_review: Some(true),
                    ..AiSettingsPatch::default()
                },
                UtcMs(NOW),
            )
            .unwrap();
        let monday_noon = (MONDAY + 7) * DAY + 12 * 3_600_000;
        r.ai.answer_with(Err(AiError::Offline));
        assert!(matches!(
            r.service.run_monday_review("English", UtcMs(monday_noon)),
            MondayReview::Failed(m) if m.contains("internet connection")
        ));
        assert!(r.reviews.all().is_empty());
        let settings = r.service.settings().unwrap();
        assert!(settings.last_auto_error.is_some());
        assert_eq!(
            settings.last_auto_week_day, None,
            "still due on the next launch"
        );

        // The next launch, back online: it goes through.
        r.ai.answer_with(Ok(GOOD_ANSWER.into()));
        assert!(matches!(
            r.service
                .run_monday_review("English", UtcMs(monday_noon + 5000)),
            MondayReview::Done(_)
        ));
        assert!(r.service.settings().unwrap().last_auto_error.is_none());
    }

    #[test]
    fn notes_are_saved_per_week_and_blank_removes_them() {
        let r = rig();
        r.service
            .set_note(MONDAY, "  Felt rushed on Tuesday  ")
            .unwrap();
        assert_eq!(r.service.note(MONDAY).unwrap(), "Felt rushed on Tuesday");
        assert_eq!(
            r.service.summary(0, UtcMs(NOW)).unwrap().note,
            "Felt rushed on Tuesday"
        );
        assert_eq!(r.service.summary(1, UtcMs(NOW)).unwrap().note, "");
        r.service.set_note(MONDAY, "   ").unwrap();
        assert_eq!(r.service.note(MONDAY).unwrap(), "");
        assert!(matches!(
            r.service.set_note(MONDAY, &"x".repeat(MAX_NOTE_CHARS + 1)),
            Err(ReviewError::Invalid(_))
        ));
    }

    #[test]
    fn weeks_too_far_back_are_rejected() {
        let r = rig();
        assert!(matches!(
            r.service.summary(MAX_WEEKS_AGO + 1, UtcMs(NOW)),
            Err(ReviewError::Invalid(_))
        ));
    }

    #[test]
    fn a_cancelled_analysis_stops_and_saves_nothing() {
        let r = rig();
        enabled(&r);
        r.ai.hang();
        let preview = r.service.preview(0, false, "English", UtcMs(NOW)).unwrap();
        // `cancel` with nothing running is harmless.
        r.service.cancel();
        let outcome = std::thread::scope(|scope| {
            let running = scope.spawn(|| r.service.run(&preview.id, UtcMs(NOW)));
            // Wait until the call is in flight, then cancel it.
            while r.ai.traffic() == 0 {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            r.service.cancel();
            running.join().unwrap()
        });
        assert_eq!(outcome, Err(ReviewError::Ai(AiError::Cancelled)));
        assert!(r.reviews.all().is_empty());
    }
}
