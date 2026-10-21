//! OpenAI Responses API (`POST /v1/responses`) and `GET /v1/models`.
//!
//! Verified against the official docs (developers.openai.com, Structured Outputs and the
//! Responses reference): `Authorization: Bearer`, `instructions` + `input`, `store: false`,
//! `max_output_tokens`, and the JSON answer through
//! `text.format = {type: "json_schema", name, schema, strict: true}`. The answer is the
//! `output_text` content of the `message` items of `output`; a `refusal` content part and
//! `status: "incomplete"` are reported instead of a review.

use std::time::Duration;

use application::ai::{AiError, AiRequest};
use serde_json::{Value, json};

use crate::transport::{HttpRequest, Method};

pub const DEFAULT_BASE: &str = "https://api.openai.com";

fn headers(key: &str) -> Vec<(&'static str, String)> {
    vec![
        ("authorization", format!("Bearer {key}")),
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
        "instructions": request.system,
        "input": request.user,
        "max_output_tokens": request.max_output_tokens,
        "store": false,
        "text": { "format": {
            "type": "json_schema",
            "name": "weekly_review",
            "schema": request.schema,
            "strict": true,
        } },
    });
    HttpRequest {
        method: Method::Post,
        url: format!("{}/v1/responses", base.trim_end_matches('/')),
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
    if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
        return Err(AiError::BadResponse(message.to_owned()));
    }
    let mut text = String::new();
    let mut refusal = None;
    for item in value
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|i| i.get("type").and_then(Value::as_str) == Some("message"))
    {
        for part in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            match part.get("type").and_then(Value::as_str) {
                Some("output_text") => {
                    text.push_str(part.get("text").and_then(Value::as_str).unwrap_or_default());
                }
                Some("refusal") => {
                    refusal = part
                        .get("refusal")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                }
                _ => {}
            }
        }
    }
    if let Some(reason) = refusal {
        return Err(AiError::BadResponse(format!(
            "the model declined to answer: {reason}"
        )));
    }
    if text.trim().is_empty() {
        let incomplete = value.get("status").and_then(Value::as_str) == Some("incomplete");
        return Err(AiError::BadResponse(if incomplete {
            "the answer was cut off before it started".into()
        } else {
            "the answer has no text".into()
        }));
    }
    Ok(text)
}

pub fn models_request(base: &str, key: &str, timeout: Duration) -> HttpRequest {
    HttpRequest {
        method: Method::Get,
        url: format!("{}/v1/models", base.trim_end_matches('/')),
        headers: headers(key),
        body: None,
        timeout,
        pin: None,
        no_proxy: false,
    }
}

/// Ids of the models that can write text (embeddings, speech and image models are left out).
pub fn parse_models(body: &str) -> Result<Vec<String>, AiError> {
    const NOT_FOR_TEXT: [&str; 10] = [
        "embedding",
        "whisper",
        "tts",
        "dall-e",
        "moderation",
        "image",
        "audio",
        "realtime",
        "transcribe",
        "search",
    ];
    let value: Value = serde_json::from_str(body)
        .map_err(|_| AiError::BadResponse("the model list is not JSON".into()))?;
    Ok(value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::BadResponse("the model list has no data".into()))?
        .iter()
        .filter_map(|m| m.get("id").and_then(Value::as_str))
        .filter(|id| !NOT_FOR_TEXT.iter().any(|bad| id.contains(bad)))
        .map(str::to_owned)
        .collect())
}
