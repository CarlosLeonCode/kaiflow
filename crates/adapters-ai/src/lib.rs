//! AI providers for the weekly review. The only crate that opens AI connections, and only
//! when a use case in `application::review` asks after checking the user's opt-in.
//!
//! * Blocking `reqwest` on rustls, run by the caller on the blocking pool.
//! * Timeouts: 60 s for the cloud providers, 180 s for Ollama (local models are slow).
//! * Redirects are never followed; answers are capped at 1 MiB; errors never carry the key.
//! * Ollama is loopback only, whatever the scheme: the address is validated and `localhost`
//!   is resolved and checked before a connection is made.

pub mod anthropic;
pub mod gemini;
pub mod ollama;
pub mod openai;
pub mod transport;

use std::net::IpAddr;
use std::time::Duration;

use application::ai::{
    AiConfig, AiError, AiProvider, AiRequest, CancelToken, DEFAULT_OLLAMA_URL, ProviderKind,
    Secret, loopback_target,
};

use crate::transport::{HttpRequest, resolve_loopback};

/// Total time allowed for a cloud request.
pub const CLOUD_TIMEOUT: Duration = Duration::from_secs(60);
/// Total time allowed for a request to a local model.
pub const LOCAL_TIMEOUT: Duration = Duration::from_secs(180);
const LIST_CLOUD_TIMEOUT: Duration = Duration::from_secs(30);
const LIST_LOCAL_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_MODEL_PAGES: usize = 10;

/// Where the cloud providers live. Tests point them at a local server.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub anthropic: String,
    pub gemini: String,
    pub openai: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            anthropic: anthropic::DEFAULT_BASE.into(),
            gemini: gemini::DEFAULT_BASE.into(),
            openai: openai::DEFAULT_BASE.into(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Timeouts {
    pub cloud: Duration,
    pub local: Duration,
    pub list_cloud: Duration,
    pub list_local: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            cloud: CLOUD_TIMEOUT,
            local: LOCAL_TIMEOUT,
            list_cloud: LIST_CLOUD_TIMEOUT,
            list_local: LIST_LOCAL_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct HttpAiProvider {
    endpoints: Endpoints,
    timeouts: Timeouts,
}

impl HttpAiProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_endpoints(mut self, endpoints: Endpoints) -> Self {
        self.endpoints = endpoints;
        self
    }

    pub fn with_timeouts(mut self, timeouts: Timeouts) -> Self {
        self.timeouts = timeouts;
        self
    }

    fn key(key: Option<&Secret>) -> Result<&str, AiError> {
        key.map(Secret::expose).ok_or(AiError::Unauthorized)
    }

    /// Ollama's base URL after the loopback checks, and the address to pin for `localhost`.
    fn ollama_target(
        config: &AiConfig,
    ) -> Result<(String, Option<(String, std::net::SocketAddr)>), AiError> {
        let base = config
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .unwrap_or(DEFAULT_OLLAMA_URL)
            .to_owned();
        let (host, port) = loopback_target(&base)?;
        let pin = if host.parse::<IpAddr>().is_ok() {
            None
        } else {
            Some((host.clone(), resolve_loopback(&host, port)?))
        };
        Ok((base, pin))
    }

    fn run(
        request: HttpRequest,
        key: Option<&str>,
        cancel: &CancelToken,
    ) -> Result<String, AiError> {
        transport::send(request, key, cancel).map(|r| r.body)
    }
}

impl AiProvider for HttpAiProvider {
    fn complete(
        &self,
        request: &AiRequest,
        key: Option<&Secret>,
        cancel: &CancelToken,
    ) -> Result<String, AiError> {
        let cloud = self.timeouts.cloud;
        match request.config.provider {
            ProviderKind::Anthropic => {
                let key = Self::key(key)?;
                let http =
                    anthropic::complete_request(&self.endpoints.anthropic, request, key, cloud);
                anthropic::parse_completion(&Self::run(http, Some(key), cancel)?)
            }
            ProviderKind::Gemini => {
                let key = Self::key(key)?;
                let http = gemini::complete_request(&self.endpoints.gemini, request, key, cloud)?;
                gemini::parse_completion(&Self::run(http, Some(key), cancel)?)
            }
            ProviderKind::OpenAi => {
                let key = Self::key(key)?;
                let http = openai::complete_request(&self.endpoints.openai, request, key, cloud);
                openai::parse_completion(&Self::run(http, Some(key), cancel)?)
            }
            ProviderKind::Ollama => {
                let (base, pin) = Self::ollama_target(&request.config)?;
                let mut http = ollama::complete_request(&base, request, self.timeouts.local);
                http.pin = pin;
                ollama::parse_completion(&Self::run(http, None, cancel)?)
            }
        }
    }

    fn list_models(
        &self,
        config: &AiConfig,
        key: Option<&Secret>,
        cancel: &CancelToken,
    ) -> Result<Vec<String>, AiError> {
        let mut models = Vec::new();
        match config.provider {
            ProviderKind::Anthropic => {
                let key = Self::key(key)?;
                let mut after: Option<String> = None;
                for _ in 0..MAX_MODEL_PAGES {
                    let http = anthropic::models_request(
                        &self.endpoints.anthropic,
                        key,
                        after.as_deref(),
                        self.timeouts.list_cloud,
                    );
                    let (page, next) =
                        anthropic::parse_models(&Self::run(http, Some(key), cancel)?)?;
                    models.extend(page);
                    match next {
                        Some(next) => after = Some(next),
                        None => break,
                    }
                }
            }
            ProviderKind::Gemini => {
                let key = Self::key(key)?;
                let mut token: Option<String> = None;
                for _ in 0..MAX_MODEL_PAGES {
                    let http = gemini::models_request(
                        &self.endpoints.gemini,
                        key,
                        token.as_deref(),
                        self.timeouts.list_cloud,
                    );
                    let (page, next) = gemini::parse_models(&Self::run(http, Some(key), cancel)?)?;
                    models.extend(page);
                    match next {
                        Some(next) => token = Some(next),
                        None => break,
                    }
                }
            }
            ProviderKind::OpenAi => {
                let key = Self::key(key)?;
                let http =
                    openai::models_request(&self.endpoints.openai, key, self.timeouts.list_cloud);
                models = openai::parse_models(&Self::run(http, Some(key), cancel)?)?;
            }
            ProviderKind::Ollama => {
                let (base, pin) = Self::ollama_target(config)?;
                let mut http = ollama::models_request(&base, self.timeouts.list_local);
                http.pin = pin;
                models = ollama::parse_models(&Self::run(http, None, cancel)?)?;
            }
        }
        models.sort();
        models.dedup();
        Ok(models)
    }
}

/// Percent-encodes a query value (paging cursors are opaque strings).
pub(crate) fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
