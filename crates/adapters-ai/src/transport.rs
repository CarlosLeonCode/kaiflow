//! One blocking HTTP exchange, with the guarantees every provider shares: a total timeout,
//! no redirects, a bounded answer, cancellation, and errors that never carry the API key.

use std::io::Read;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::mpsc;
use std::time::Duration;

use application::ai::{AiError, CancelToken};

/// Longest answer read from a provider (a review is a few kilobytes).
pub const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How often a waiting call looks at its cancel token.
const CANCEL_POLL: Duration = Duration::from_millis(25);
/// Longest provider message kept in an error.
const MAX_MESSAGE_CHARS: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

#[derive(Clone)]
pub struct HttpRequest {
    pub method: Method,
    pub url: String,
    /// Header values may hold the API key: `Debug` never prints them.
    pub headers: Vec<(&'static str, String)>,
    pub body: Option<String>,
    pub timeout: Duration,
    /// Connect to this address for `host` instead of resolving it (checked loopback for
    /// Ollama's `localhost`).
    pub pin: Option<(String, SocketAddr)>,
    /// Bypass any proxy (local traffic must stay local).
    pub no_proxy: bool,
}

impl std::fmt::Debug for HttpRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpRequest")
            .field("method", &self.method)
            .field("url", &self.url)
            .field(
                "headers",
                &self.headers.iter().map(|(n, _)| *n).collect::<Vec<_>>(),
            )
            .field("body_bytes", &self.body.as_ref().map(String::len))
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub retry_after_secs: Option<u64>,
    pub body: String,
}

/// Installs the rustls crypto provider once. reqwest is built without one so that the app
/// links a single provider (ring); a provider installed earlier by another crate is fine.
pub fn ensure_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// Sends `request` on a worker thread and waits for it, polling `cancel`. A cancelled call
/// returns at once; the worker finishes (or times out) on its own and its result is dropped.
pub fn send(
    request: HttpRequest,
    key: Option<&str>,
    cancel: &CancelToken,
) -> Result<HttpResponse, AiError> {
    if cancel.is_cancelled() {
        return Err(AiError::Cancelled);
    }
    ensure_crypto_provider();
    let (tx, rx) = mpsc::channel();
    let timeout = request.timeout;
    std::thread::Builder::new()
        .name("ai-http".into())
        .spawn(move || {
            let _ = tx.send(exchange(&request));
        })
        .map_err(|_| AiError::Offline)?;

    // The worker has its own total timeout; the grace period only guards a stuck thread.
    let deadline = std::time::Instant::now() + timeout + Duration::from_secs(5);
    let outcome = loop {
        match rx.recv_timeout(CANCEL_POLL) {
            Ok(result) => break result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if cancel.is_cancelled() {
                    return Err(AiError::Cancelled);
                }
                if std::time::Instant::now() >= deadline {
                    return Err(AiError::Timeout);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(AiError::Offline),
        }
    };
    let response = outcome?;
    check_status(response, key)
}

fn exchange(request: &HttpRequest) -> Result<HttpResponse, AiError> {
    let mut builder = reqwest::blocking::Client::builder()
        // A redirect could carry the request (and its key header) somewhere else.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT.min(request.timeout))
        .timeout(request.timeout)
        .user_agent(concat!("time-track-copilot/", env!("CARGO_PKG_VERSION")));
    if request.no_proxy {
        builder = builder.no_proxy();
    }
    if let Some((host, addr)) = &request.pin {
        builder = builder.resolve(host, *addr);
    }
    let client = builder.build().map_err(|_| AiError::Offline)?;

    let mut call = match request.method {
        Method::Get => client.get(&request.url),
        Method::Post => client.post(&request.url),
    };
    for (name, value) in &request.headers {
        call = call.header(*name, value);
    }
    if let Some(body) = &request.body {
        call = call.body(body.clone());
    }
    let response = call.send().map_err(map_reqwest)?;

    let status = response.status().as_u16();
    let retry_after_secs = response
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok());
    let mut body = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::TimedOut {
                AiError::Timeout
            } else {
                AiError::BadResponse("the answer could not be read completely".into())
            }
        })?;
    if body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(AiError::BadResponse("the answer is too large".into()));
    }
    Ok(HttpResponse {
        status,
        retry_after_secs,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

/// reqwest's messages include the URL; only the class of failure is kept.
fn map_reqwest(error: reqwest::Error) -> AiError {
    if error.is_timeout() {
        AiError::Timeout
    } else if error.is_connect() || error.is_request() {
        AiError::Offline
    } else if error.is_redirect() {
        AiError::BadResponse("the provider tried to redirect the request".into())
    } else {
        AiError::BadResponse("the exchange with the provider failed".into())
    }
}

/// Turns HTTP failures into [`AiError`]s; the body is parsed by the provider only on success.
fn check_status(response: HttpResponse, key: Option<&str>) -> Result<HttpResponse, AiError> {
    match response.status {
        200..=299 => Ok(response),
        401 | 403 => Err(AiError::Unauthorized),
        429 => Err(AiError::RateLimited {
            retry_after_secs: response.retry_after_secs,
        }),
        status => Err(AiError::Provider {
            status,
            message: provider_message(&response.body, key),
        }),
    }
}

/// The provider's own explanation, without the key and short.
pub fn provider_message(body: &str, key: Option<&str>) -> String {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let text = parsed
        .as_ref()
        .and_then(|v| {
            // Anthropic and OpenAI: error.message; Gemini: error.message; Ollama: error (string).
            v.pointer("/error/message")
                .or_else(|| v.get("error"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| body.to_owned());
    let mut text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some(key) = key.filter(|k| !k.is_empty()) {
        text = text.replace(key, "***");
    }
    if text.chars().count() > MAX_MESSAGE_CHARS {
        text = text.chars().take(MAX_MESSAGE_CHARS - 1).collect::<String>() + "…";
    }
    if text.is_empty() {
        "no details".into()
    } else {
        text
    }
}

/// Resolves `host:port` and checks every address is loopback; returns the one to connect to.
/// `localhost` could be pointed elsewhere through the hosts file or DNS, so it is checked
/// rather than trusted.
pub fn resolve_loopback(host: &str, port: u16) -> Result<SocketAddr, AiError> {
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| AiError::Offline)?
        .collect();
    if addrs.is_empty() || addrs.iter().any(|a| !a.ip().is_loopback()) {
        return Err(AiError::RemoteHostRejected);
    }
    // Ollama listens on IPv4 by default; prefer it when `localhost` has both.
    Ok(addrs
        .iter()
        .copied()
        .find(SocketAddr::is_ipv4)
        .unwrap_or(addrs[0]))
}
