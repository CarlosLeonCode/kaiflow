//! Google Gemini `generateContent` (`POST /v1beta/models/{model}:generateContent`) and
//! `GET /v1beta/models`.
//!
//! Verified against the official docs (ai.google.dev, generateContent reference; Google states
//! `generateContent` "remains fully supported" next to the newer Interactions API): header
//! `x-goog-api-key`, `systemInstruction`, `contents[].parts[].text`, and the JSON answer through
//! `generationConfig.responseMimeType = "application/json"` plus `responseJsonSchema`. The
//! answer is the text of `candidates[0].content.parts` (thought parts skipped).

use std::time::Duration;

use application::ai::{AiError, AiRequest};
use serde_json::{Value, json};

use crate::transport::{HttpRequest, Method};

pub const DEFAULT_BASE: &str = "https://generativelanguage.googleapis.com";

fn headers(key: &str) -> Vec<(&'static str, String)> {
    vec![
        ("x-goog-api-key", key.to_owned()),
        ("content-type", "application/json".to_owned()),
    ]
}

/// A model id is a path segment: refuse anything that could change the URL.
fn model_segment(model: &str) -> Result<&str, AiError> {
    let id = model.strip_prefix("models/").unwrap_or(model);
    let ok = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if ok {
        Ok(id)
    } else {
        Err(AiError::BadResponse("the model name is not valid".into()))
    }
}

pub fn complete_request(
    base: &str,
    request: &AiRequest,
    key: &str,
    timeout: Duration,
) -> Result<HttpRequest, AiError> {
    let model = model_segment(&request.config.model)?;
    let body = json!({
        "systemInstruction": { "parts": [{ "text": request.system }] },
        "contents": [{ "role": "user", "parts": [{ "text": request.user }] }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": request.schema,
            "maxOutputTokens": request.max_output_tokens,
        },
    });
    Ok(HttpRequest {
        method: Method::Post,
        url: format!(
            "{}/v1beta/models/{model}:generateContent",
            base.trim_end_matches('/')
        ),
        headers: headers(key),
        body: Some(body.to_string()),
        timeout,
        pin: None,
        no_proxy: false,
    })
}

pub fn parse_completion(body: &str) -> Result<String, AiError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| AiError::BadResponse("the answer is not JSON".into()))?;
    if let Some(reason) = value
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
    {
        return Err(AiError::BadResponse(format!(
            "the provider blocked the request ({reason})"
        )));
    }
    let candidate = value
        .pointer("/candidates/0")
        .ok_or_else(|| AiError::BadResponse("the answer has no candidates".into()))?;
    let text: String = candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter(|p| p.get("thought").and_then(Value::as_bool) != Some(true))
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.trim().is_empty() {
        let reason = candidate
            .get("finishReason")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(AiError::BadResponse(format!(
            "the answer has no text (finish reason: {reason})"
        )));
    }
    Ok(text)
}

pub fn models_request(base: &str, key: &str, page: Option<&str>, timeout: Duration) -> HttpRequest {
    let mut url = format!("{}/v1beta/models?pageSize=1000", base.trim_end_matches('/'));
    if let Some(page) = page {
        url.push_str("&pageToken=");
        url.push_str(&crate::percent_encode(page));
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

/// Models that can `generateContent`, without the `models/` prefix, and the next page token.
pub fn parse_models(body: &str) -> Result<(Vec<String>, Option<String>), AiError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| AiError::BadResponse("the model list is not JSON".into()))?;
    let ids = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::BadResponse("the model list has no models".into()))?
        .iter()
        .filter(|m| {
            m.get("supportedGenerationMethods")
                .and_then(Value::as_array)
                .is_none_or(|methods| methods.iter().any(|x| x == "generateContent"))
        })
        .filter_map(|m| m.get("name").and_then(Value::as_str))
        .map(|n| n.strip_prefix("models/").unwrap_or(n).to_owned())
        .collect();
    let next = value
        .get("nextPageToken")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .map(str::to_owned);
    Ok((ids, next))
}
