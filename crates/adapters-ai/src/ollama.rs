//! Ollama on this computer: `POST /api/chat` (`stream: false`, `format` = JSON schema) and
//! `GET /api/tags`. Verified against the official docs (docs.ollama.com, api.md and
//! Structured outputs). The answer is `message.content`.

use std::time::Duration;

use application::ai::{AiError, AiRequest};
use serde_json::{Value, json};

use crate::transport::{HttpRequest, Method};

fn headers() -> Vec<(&'static str, String)> {
    vec![("content-type", "application/json".to_owned())]
}

pub fn complete_request(base: &str, request: &AiRequest, timeout: Duration) -> HttpRequest {
    let body = json!({
        "model": request.config.model,
        "messages": [
            { "role": "system", "content": request.system },
            { "role": "user", "content": request.user },
        ],
        "stream": false,
        "format": request.schema,
        "options": { "num_predict": request.max_output_tokens },
    });
    HttpRequest {
        method: Method::Post,
        url: format!("{}/api/chat", base.trim_end_matches('/')),
        headers: headers(),
        body: Some(body.to_string()),
        timeout,
        pin: None,
        no_proxy: true,
    }
}

pub fn parse_completion(body: &str) -> Result<String, AiError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| AiError::BadResponse("the answer is not JSON".into()))?;
    if let Some(message) = value.get("error").and_then(Value::as_str) {
        return Err(AiError::BadResponse(message.to_owned()));
    }
    let text = value
        .pointer("/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if text.trim().is_empty() {
        return Err(AiError::BadResponse("the answer has no text".into()));
    }
    Ok(text.to_owned())
}

pub fn models_request(base: &str, timeout: Duration) -> HttpRequest {
    HttpRequest {
        method: Method::Get,
        url: format!("{}/api/tags", base.trim_end_matches('/')),
        headers: headers(),
        body: None,
        timeout,
        pin: None,
        no_proxy: true,
    }
}

pub fn parse_models(body: &str) -> Result<Vec<String>, AiError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| AiError::BadResponse("the model list is not JSON".into()))?;
    Ok(value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::BadResponse("the model list has no models".into()))?
        .iter()
        .filter_map(|m| m.get("name").and_then(Value::as_str))
        .map(str::to_owned)
        .collect())
}
