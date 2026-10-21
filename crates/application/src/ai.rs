//! Ports and values for the optional AI weekly review (spec: weekly-review-ai).
//!
//! Nothing here talks to a network or to a keychain: [`AiProvider`] and [`SecretStore`] are
//! implemented by adapters, so the use cases (`review.rs`) stay testable with fakes. Every AI
//! call is explicit: the use cases check the per-provider opt-in in [`AiSettings`] before any
//! port is touched.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Key of the [`AiSettings`] blob.
pub const KEY_AI: &str = "ai";

/// Largest answer asked of a model (thinking tokens count against it on some providers).
pub const MAX_OUTPUT_TOKENS: u32 = 4096;

/// Service name entries use in the OS keychain; the user name is the provider.
pub const KEYCHAIN_SERVICE: &str = "com.carlosleon.kaiflow";

/// Service name used before the rename to Kaiflow. Keys found there are moved to
/// [`KEYCHAIN_SERVICE`] the first time they are read (see `secret_migration`).
pub const LEGACY_KEYCHAIN_SERVICE: &str = "com.timetrack.copilot.ai";

/// Where Ollama is expected unless the user typed another loopback address.
pub const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ProviderKind {
    Anthropic,
    Gemini,
    OpenAi,
    Ollama,
}

impl ProviderKind {
    pub const ALL: [Self; 4] = [Self::Anthropic, Self::Gemini, Self::OpenAi, Self::Ollama];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::OpenAi => "openai",
            Self::Ollama => "ollama",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == name)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Anthropic => "Anthropic (Claude)",
            Self::Gemini => "Google Gemini",
            Self::OpenAi => "OpenAI",
            Self::Ollama => "Ollama (on this computer)",
        }
    }

    /// Every provider but Ollama needs an API key.
    pub fn needs_key(self) -> bool {
        self != Self::Ollama
    }

    /// Runs on this computer: the data never leaves it.
    pub fn is_local(self) -> bool {
        self == Self::Ollama
    }

    /// The cheapest current model of the provider (verified against the provider docs;
    /// the user can type another one). Ollama has none: it depends on what is installed.
    pub fn default_model(self) -> &'static str {
        match self {
            Self::Anthropic => "claude-haiku-5-5",
            Self::Gemini => "gemini-3.5-flash-lite",
            Self::OpenAi => "gpt-6-luna",
            Self::Ollama => "",
        }
    }
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---- secrets ----

/// An API key. `Debug` never shows it and there is no `Display`.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretAvailability {
    Available,
    /// There is no secure store (for instance a Linux session without a Secret Service).
    /// Keys are refused rather than kept anywhere less safe.
    Unavailable(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    Unavailable(String),
    Failed(String),
}

impl fmt::Display for SecretError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(m) | Self::Failed(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for SecretError {}

/// The OS keychain. Keys are only ever written through [`SecretStore::set`] and only read by
/// the use case that is about to call the provider; no command returns them.
pub trait SecretStore: Send + Sync {
    fn availability(&self) -> SecretAvailability;
    fn get(&self, provider: ProviderKind) -> Result<Option<Secret>, SecretError>;
    fn set(&self, provider: ProviderKind, secret: &Secret) -> Result<(), SecretError>;
    /// Deleting a key that does not exist is not an error.
    fn delete(&self, provider: ProviderKind) -> Result<(), SecretError>;
}

// ---- provider port ----

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConfig {
    pub provider: ProviderKind,
    pub model: String,
    /// Ollama only: where it listens. Must be loopback.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiRequest {
    pub config: AiConfig,
    /// Instructions of the assistant. Never contains user data.
    pub system: String,
    /// The user turn: the user data, delimited.
    pub user: String,
    /// JSON schema the answer must follow (portable subset, see [`review_schema`]).
    pub schema: Value,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiError {
    /// The provider could not be reached (no connection, DNS, refused).
    Offline,
    Timeout,
    RateLimited {
        retry_after_secs: Option<u64>,
    },
    /// The provider rejected the key (401/403).
    Unauthorized,
    /// An Ollama address that is not loopback.
    RemoteHostRejected,
    /// Any other HTTP error; the message comes from the provider and is already trimmed.
    Provider {
        status: u16,
        message: String,
    },
    /// The answer could not be read at all (not the schema: that falls back to text).
    BadResponse(String),
    Cancelled,
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Offline => f.write_str(
                "Could not reach the provider. Check your internet connection and try again.",
            ),
            Self::Timeout => f.write_str(
                "The provider took too long to answer. Nothing was saved; try again in a moment.",
            ),
            Self::RateLimited {
                retry_after_secs: Some(s),
            } => write!(
                f,
                "The provider is limiting requests right now (HTTP 429). Try again in about {s} seconds."
            ),
            Self::RateLimited {
                retry_after_secs: None,
            } => f.write_str(
                "The provider is limiting requests right now (HTTP 429). Wait a little and try again.",
            ),
            Self::Unauthorized => {
                f.write_str("The provider rejected the API key. Check it and save it again.")
            }
            Self::RemoteHostRejected => f.write_str(
                "Ollama must run on this computer: only localhost addresses are allowed.",
            ),
            Self::Provider { status, message } => {
                write!(f, "The provider returned an error (HTTP {status}): {message}")
            }
            Self::BadResponse(m) => write!(f, "The provider's answer could not be read: {m}"),
            Self::Cancelled => f.write_str("The analysis was cancelled."),
        }
    }
}

impl std::error::Error for AiError {}

/// Cooperative cancellation shared between the command that waits and the adapter.
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Talks to the model providers. The only thing in the app that can open an AI connection.
pub trait AiProvider: Send + Sync {
    /// Sends the request and returns the text of the answer (JSON text when the provider
    /// honoured the schema). Blocks until done, timed out or cancelled.
    fn complete(
        &self,
        request: &AiRequest,
        key: Option<&Secret>,
        cancel: &CancelToken,
    ) -> Result<String, AiError>;

    /// Model ids the account can use, best effort, sorted.
    fn list_models(
        &self,
        config: &AiConfig,
        key: Option<&Secret>,
        cancel: &CancelToken,
    ) -> Result<Vec<String>, AiError>;
}

// ---- loopback guard ----

/// Checks that `url` points at this computer (`localhost`, `127.0.0.0/8` or `::1`), whatever
/// its scheme. Userinfo is refused (`http://localhost@evil.example` has another host).
/// Returns the host and port to connect to.
pub fn loopback_target(url: &str) -> Result<(String, u16), AiError> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://").ok_or(AiError::RemoteHostRejected)?;
    let default_port = match scheme.to_ascii_lowercase().as_str() {
        "http" => 80,
        "https" => 443,
        _ => return Err(AiError::RemoteHostRejected),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains('@') || authority.contains('\\') {
        return Err(AiError::RemoteHostRejected);
    }
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let (host, after) = inner.split_once(']').ok_or(AiError::RemoteHostRejected)?;
        let port = match after.strip_prefix(':') {
            Some(p) => p.parse().map_err(|_| AiError::RemoteHostRejected)?,
            None if after.is_empty() => default_port,
            None => return Err(AiError::RemoteHostRejected),
        };
        (host.to_owned(), port)
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (
                host.to_owned(),
                port.parse().map_err(|_| AiError::RemoteHostRejected)?,
            ),
            None => (authority.to_owned(), default_port),
        }
    };
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if loopback {
        Ok((host, port))
    } else {
        Err(AiError::RemoteHostRejected)
    }
}

// ---- settings blob ----

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderSettings {
    /// When the user switched this provider on. `None` means no AI call is ever made with it.
    pub consented_at: Option<i64>,
    /// Editable model id; empty means "the provider default".
    pub model: Option<String>,
    /// Ollama only.
    pub base_url: Option<String>,
    /// A key was saved in the keychain. Kept here (the key itself never is) so that showing
    /// the panel does not need to open the keychain.
    pub key_saved: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiSettings {
    /// The provider the review panel uses.
    pub selected: Option<String>,
    /// By provider name (`anthropic`, `gemini`, `openai`, `ollama`).
    pub providers: BTreeMap<String, ProviderSettings>,
    /// Whether the review panel sends window titles unless told otherwise.
    pub include_titles: bool,
    /// Run the previous week's review on its own on Mondays.
    pub monday_review: bool,
    /// Local day number of the week start of the last review the Monday run made.
    pub last_auto_week_day: Option<i64>,
    pub last_auto_error: Option<String>,
}

impl AiSettings {
    pub fn selected_kind(&self) -> ProviderKind {
        self.selected
            .as_deref()
            .and_then(ProviderKind::parse)
            .unwrap_or(ProviderKind::Anthropic)
    }

    pub fn provider(&self, kind: ProviderKind) -> ProviderSettings {
        self.providers
            .get(kind.as_str())
            .cloned()
            .unwrap_or_default()
    }

    pub fn is_enabled(&self, kind: ProviderKind) -> bool {
        self.providers
            .get(kind.as_str())
            .is_some_and(|p| p.consented_at.is_some())
    }

    pub fn provider_mut(&mut self, kind: ProviderKind) -> &mut ProviderSettings {
        self.providers.entry(kind.as_str().to_owned()).or_default()
    }

    /// The model to use: the user's, else the provider default.
    pub fn model_for(&self, kind: ProviderKind) -> String {
        self.provider(kind)
            .model
            .map(|m| m.trim().to_owned())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| kind.default_model().to_owned())
    }

    /// The address to use for Ollama.
    pub fn base_url_for(&self, kind: ProviderKind) -> Option<String> {
        kind.is_local().then(|| {
            self.provider(kind)
                .base_url
                .map(|u| u.trim().to_owned())
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_owned())
        })
    }

    pub fn config_for(&self, kind: ProviderKind) -> AiConfig {
        AiConfig {
            provider: kind,
            model: self.model_for(kind),
            base_url: self.base_url_for(kind),
        }
    }
}

/// Longest model id accepted.
pub const MAX_MODEL_CHARS: usize = 200;

/// Validates a model id typed by the user.
pub fn validate_model(model: &str) -> Result<String, String> {
    let model = model.trim();
    if model.chars().count() > MAX_MODEL_CHARS
        || model
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() && c != ' ')
    {
        return Err("the model name is not valid".into());
    }
    Ok(model.to_owned())
}

// ---- answer schema ----

/// Limits applied to the answer in Rust (the schema sent to providers has no length limits
/// because the portable subset of every provider does not support them).
pub const MAX_SUMMARY_CHARS: usize = 600;
pub const MAX_WINS: usize = 5;
pub const MAX_PATTERNS: usize = 5;
pub const MAX_GOAL_MISSES: usize = 10;
pub const MAX_SUGGESTIONS: usize = 3;
const MAX_ITEM_CHARS: usize = 400;

/// JSON schema every provider is asked to follow. Only the subset all four support: object
/// types, arrays, strings, every property required and `additionalProperties: false`.
pub fn review_schema() -> Value {
    let pair = |a: &str, b: &str| {
        json!({
            "type": "object",
            "properties": { a: { "type": "string" }, b: { "type": "string" } },
            "required": [a, b],
            "additionalProperties": false
        })
    };
    json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" },
            "wins": { "type": "array", "items": { "type": "string" } },
            "patterns": { "type": "array", "items": pair("observation", "evidence") },
            "goal_misses": { "type": "array", "items": pair("goal", "reason") },
            "suggestions": { "type": "array", "items": pair("action", "rationale") }
        },
        "required": ["summary", "wins", "patterns", "goal_misses", "suggestions"],
        "additionalProperties": false
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pattern {
    pub observation: String,
    pub evidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalMiss {
    pub goal: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Suggestion {
    pub action: String,
    pub rationale: String,
}

/// The structured answer of a review, validated and trimmed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewOutput {
    pub summary: String,
    pub wins: Vec<String>,
    pub patterns: Vec<Pattern>,
    pub goal_misses: Vec<GoalMiss>,
    pub suggestions: Vec<Suggestion>,
}

fn clip(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        text.to_owned()
    } else {
        let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

impl ReviewOutput {
    /// Reads the model's answer. `None` when it is not JSON of the expected shape (or has no
    /// summary): the caller then keeps the raw text instead. Lists are capped and long texts
    /// clipped so a runaway answer cannot flood the history.
    pub fn parse(text: &str) -> Option<Self> {
        let value: Value = serde_json::from_str(strip_fence(text)).ok()?;
        let mut out: Self = serde_json::from_value(value).ok()?;
        out.summary = clip(&out.summary, MAX_SUMMARY_CHARS);
        if out.summary.is_empty() {
            return None;
        }
        out.wins = out
            .wins
            .iter()
            .map(|w| clip(w, MAX_ITEM_CHARS))
            .filter(|w| !w.is_empty())
            .take(MAX_WINS)
            .collect();
        out.patterns = out
            .patterns
            .into_iter()
            .take(MAX_PATTERNS)
            .map(|p| Pattern {
                observation: clip(&p.observation, MAX_ITEM_CHARS),
                evidence: clip(&p.evidence, MAX_ITEM_CHARS),
            })
            .collect();
        out.goal_misses = out
            .goal_misses
            .into_iter()
            .take(MAX_GOAL_MISSES)
            .map(|g| GoalMiss {
                goal: clip(&g.goal, MAX_ITEM_CHARS),
                reason: clip(&g.reason, MAX_ITEM_CHARS),
            })
            .collect();
        out.suggestions = out
            .suggestions
            .into_iter()
            .take(MAX_SUGGESTIONS)
            .map(|s| Suggestion {
                action: clip(&s.action, MAX_ITEM_CHARS),
                rationale: clip(&s.rationale, MAX_ITEM_CHARS),
            })
            .collect();
        Some(out)
    }
}

/// Some models wrap JSON in a Markdown fence even when asked not to.
fn strip_fence(text: &str) -> &str {
    let t = text.trim();
    let Some(rest) = t.strip_prefix("```") else {
        return t;
    };
    let rest = rest.split_once('\n').map_or(rest, |(_, body)| body);
    rest.trim_end().strip_suffix("```").unwrap_or(rest).trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_debug_never_shows_the_value() {
        let secret = Secret::new("sk-very-secret");
        assert_eq!(format!("{secret:?}"), "Secret(***)");
        assert!(!format!("{:?}", Some(&secret)).contains("sk-very"));
        assert_eq!(secret.expose(), "sk-very-secret");
    }

    #[test]
    fn loopback_hosts_are_accepted_whatever_the_scheme() {
        for url in [
            "http://localhost:11434",
            "https://localhost:11434",
            "http://127.0.0.1:11434/api",
            "https://127.5.5.5",
            "http://[::1]:11434",
            "http://LOCALHOST",
        ] {
            assert!(loopback_target(url).is_ok(), "{url} should be accepted");
        }
        assert_eq!(
            loopback_target("http://localhost").unwrap(),
            ("localhost".into(), 80)
        );
        assert_eq!(
            loopback_target("https://[::1]").unwrap(),
            ("::1".into(), 443)
        );
    }

    #[test]
    fn remote_hosts_are_rejected_over_http_and_https() {
        for url in [
            "http://example.com:11434",
            "https://example.com",
            "http://192.168.1.20:11434",
            "http://10.0.0.5",
            "http://0.0.0.0:11434",
            "http://localhost@evil.example",
            "http://localhost:11434@evil.example/",
            "http://evil.example#@localhost",
            "http://localhost.evil.example",
            "http://[::2]:11434",
            "ftp://localhost",
            "localhost:11434",
            "",
            "http://",
        ] {
            assert_eq!(
                loopback_target(url),
                Err(AiError::RemoteHostRejected),
                "{url} must be rejected"
            );
        }
    }

    #[test]
    fn output_parses_caps_and_trims() {
        let long = "x".repeat(2000);
        let text = json!({
            "summary": format!("  {long}  "),
            "wins": ["a", "b", "c", "d", "e", "f", ""],
            "patterns": [{"observation": "o", "evidence": "e"}],
            "goal_misses": [],
            "suggestions": [
                {"action": "1", "rationale": "r"}, {"action": "2", "rationale": "r"},
                {"action": "3", "rationale": "r"}, {"action": "4", "rationale": "r"}
            ]
        })
        .to_string();
        let out = ReviewOutput::parse(&text).unwrap();
        assert_eq!(out.summary.chars().count(), MAX_SUMMARY_CHARS);
        assert!(out.summary.ends_with('…'));
        assert_eq!(out.wins.len(), MAX_WINS);
        assert_eq!(out.suggestions.len(), MAX_SUGGESTIONS);
        assert_eq!(out.patterns[0].observation, "o");
    }

    #[test]
    fn output_accepts_a_markdown_fence_and_rejects_the_rest() {
        let body = r#"{"summary":"ok","wins":[],"patterns":[],"goal_misses":[],"suggestions":[]}"#;
        assert!(ReviewOutput::parse(&format!("```json\n{body}\n```")).is_some());
        assert!(ReviewOutput::parse("You spent a lot of time on email.").is_none());
        assert!(
            ReviewOutput::parse(r#"{"summary":"x"}"#).is_none(),
            "missing lists"
        );
        assert!(
            ReviewOutput::parse(
                r#"{"summary":"  ","wins":[],"patterns":[],"goal_misses":[],"suggestions":[]}"#
            )
            .is_none(),
            "an empty summary is no answer"
        );
    }

    #[test]
    fn schema_uses_only_the_portable_subset() {
        fn walk(v: &Value) {
            if let Some(obj) = v.as_object() {
                for banned in [
                    "minLength",
                    "maxLength",
                    "minimum",
                    "maximum",
                    "pattern",
                    "format",
                    "$ref",
                    "oneOf",
                    "anyOf",
                    "default",
                ] {
                    assert!(!obj.contains_key(banned), "{banned} is not portable");
                }
                if obj.get("type") == Some(&json!("object")) {
                    assert_eq!(obj["additionalProperties"], json!(false));
                    let props: Vec<_> = obj["properties"].as_object().unwrap().keys().collect();
                    let required: Vec<_> = obj["required"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|r| r.as_str().unwrap())
                        .collect();
                    assert_eq!(props.len(), required.len());
                }
                obj.values().for_each(walk);
            } else if let Some(arr) = v.as_array() {
                arr.iter().for_each(walk);
            }
        }
        walk(&review_schema());
    }

    #[test]
    fn provider_defaults_match_the_documented_models() {
        assert_eq!(ProviderKind::Anthropic.default_model(), "claude-haiku-5-5");
        assert_eq!(
            ProviderKind::Gemini.default_model(),
            "gemini-3.5-flash-lite"
        );
        assert_eq!(ProviderKind::OpenAi.default_model(), "gpt-6-luna");
        assert!(ProviderKind::Ollama.is_local() && !ProviderKind::Ollama.needs_key());
        for kind in ProviderKind::ALL {
            assert_eq!(ProviderKind::parse(kind.as_str()), Some(kind));
        }
    }

    #[test]
    fn settings_resolve_models_and_the_ollama_address() {
        let mut s = AiSettings::default();
        assert!(!s.is_enabled(ProviderKind::Anthropic));
        assert_eq!(s.model_for(ProviderKind::Anthropic), "claude-haiku-5-5");
        s.provider_mut(ProviderKind::Anthropic).model = Some("  claude-opus-5-5 ".into());
        assert_eq!(s.model_for(ProviderKind::Anthropic), "claude-opus-5-5");
        assert_eq!(s.base_url_for(ProviderKind::Gemini), None);
        assert_eq!(
            s.base_url_for(ProviderKind::Ollama).as_deref(),
            Some(DEFAULT_OLLAMA_URL)
        );
        s.provider_mut(ProviderKind::Ollama).consented_at = Some(5);
        assert!(s.is_enabled(ProviderKind::Ollama));
    }

    #[test]
    fn model_names_are_validated() {
        assert_eq!(validate_model(" gpt-6-luna ").unwrap(), "gpt-6-luna");
        assert!(validate_model("a\nb").is_err());
        assert!(validate_model(&"x".repeat(201)).is_err());
    }
}
