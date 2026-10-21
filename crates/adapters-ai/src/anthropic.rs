//! Anthropic Messages API (`POST /v1/messages`, `GET /v1/models`).
//!
//! Verified against the official docs (platform.claude.com, Messages and Structured outputs):
//! headers `x-api-key` and `anthropic-version: 2023-06-01`; the JSON answer is requested with
//! `output_config.format = {type: "json_schema", schema}` (GA; it replaced forcing a tool);
//! the answer is the concatenation of the `text` blocks of `content`.

use std::time::Duration;

use application::ai::{AiError, AiRequest};
use serde_json::{Value, json};

use crate::transport::{HttpRequest, Method};

pub const DEFAULT_BASE: &str = "https://api.anthropic.com";
const VERSION: &str = "2023-06-01";

fn headers(key: &str) -> Vec<(&'static str, String)> {
    vec![
        ("x-api-key", key.to_owned()),
        ("anthropic-version", VERSION.to_owned()),
        ("content-type", "application/json".to_owned()),
    ]
}

pub fn complete_request(
    base: &str,
    request: &AiRequest,
    key: &str,
    timeout: Duration,
) -> HttpRequest {
    let body = json!({
        "model": request.config.model,
        "max_tokens": request.max_output_tokens,
        "system": request.system,
        "messages": [{ "role": "user", "content": request.user }],
        "output_config": { "format": { "type": "json_schema", "schema": request.schema } },
    });
    HttpRequest {
        method: Method::Post,
        url: format!("{}/v1/messages", base.trim_end_matches('/')),
        headers: headers(key),
        body: Some(body.to_string()),
        timeout,
        pin: None,
        no_proxy: false,
    }
}

pub fn parse_completion(body: &str) -> Result<String, AiError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| AiError::BadResponse("the answer is not JSON".into()))?;
    let stop = value.get("stop_reason").and_then(Value::as_str);
    let text: String = value
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if stop == Some("refusal") {
        return Err(AiError::BadResponse("the model declined to answer".into()));
    }
    if text.trim().is_empty() {
        return Err(AiError::BadResponse(if stop == Some("max_tokens") {
            "the answer was cut off before it started".into()
        } else {
            "the answer has no text".into()
        }));
    }
    Ok(text)
}

pub fn models_request(
    base: &str,
    key: &str,
    after: Option<&str>,
    timeout: Duration,
) -> HttpRequest {
    let mut url = format!("{}/v1/models?limit=1000", base.trim_end_matches('/'));
    if let Some(after) = after {
        url.push_str("&after_id=");
        url.push_str(&crate::percent_encode(after));
    }
    HttpRequest {
        method: Method::Get,
        url,
        headers: headers(key),
        body: None,
        timeout,
        pin: None,
        no_proxy: false,
    }
}

/// Model ids and the cursor of the next page, if any.
pub fn parse_models(body: &str) -> Result<(Vec<String>, Option<String>), AiError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| AiError::BadResponse("the model list is not JSON".into()))?;
    let ids = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::BadResponse("the model list has no data".into()))?
        .iter()
        .filter_map(|m| m.get("id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect();
    let next = (value.get("has_more").and_then(Value::as_bool) == Some(true))
        .then(|| {
            value
                .get("last_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .flatten();
    Ok((ids, next))
}
