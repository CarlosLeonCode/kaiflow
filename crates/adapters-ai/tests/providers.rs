//! The four providers against a local HTTP server: request shapes, answers, errors, timeouts,
//! cancellation, redirects and the loopback rule. No real network is used.

mod support;

use std::time::{Duration, Instant};

use adapters_ai::{Endpoints, HttpAiProvider, Timeouts};
use application::ai::{
    AiConfig, AiError, AiProvider, AiRequest, CancelToken, ProviderKind, Secret, review_schema,
};
use serde_json::json;
use support::{Reply, Server, closed_port_url};

const KEY: &str = "sk-test-key-0123456789";
const ANSWER: &str =
    r#"{"summary":"ok","wins":[],"patterns":[],"goal_misses":[],"suggestions":[]}"#;

fn request(kind: ProviderKind, model: &str, base_url: Option<&str>) -> AiRequest {
    AiRequest {
        config: AiConfig {
            provider: kind,
            model: model.into(),
            base_url: base_url.map(Into::into),
        },
        system: "You help with reflection. Do not assume the user's profession.".into(),
        user: "Here is the week.\n<data>{\"totals\":{}}</data>".into(),
        schema: review_schema(),
        max_output_tokens: 4096,
    }
}

fn provider_for(server: &Server) -> HttpAiProvider {
    HttpAiProvider::new().with_endpoints(Endpoints {
        anthropic: server.url(),
        gemini: server.url(),
        openai: server.url(),
    })
}

fn fast(provider: HttpAiProvider, millis: u64) -> HttpAiProvider {
    let t = Duration::from_millis(millis);
    provider.with_timeouts(Timeouts {
        cloud: t,
        local: t,
        list_cloud: t,
        list_local: t,
    })
}

fn complete(
    provider: &HttpAiProvider,
    request: &AiRequest,
    key: Option<&str>,
) -> Result<String, AiError> {
    provider.complete(
        request,
        key.map(Secret::new).as_ref(),
        &CancelToken::default(),
    )
}

// ---- Anthropic ----

fn anthropic_ok() -> String {
    json!({
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
        "content": [
            {"type": "thinking", "thinking": "hmm", "signature": "x"},
            {"type": "text", "text": ANSWER}
        ],
        "stop_reason": "end_turn"
    })
    .to_string()
}

#[test]
fn anthropic_sends_the_documented_request_and_reads_the_text_blocks() {
    let server = Server::start(|_| Reply::json(200, &anthropic_ok()));
    let provider = provider_for(&server);
    let req = request(ProviderKind::Anthropic, "claude-haiku-5-5", None);
    assert_eq!(complete(&provider, &req, Some(KEY)).unwrap(), ANSWER);

    let sent = &server.requests()[0];
    assert_eq!(
        (sent.method.as_str(), sent.target.as_str()),
        ("POST", "/v1/messages")
    );
    assert_eq!(sent.header("x-api-key"), Some(KEY));
    assert_eq!(sent.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(sent.header("authorization"), None);
    let body = sent.json();
    assert_eq!(body["model"], "claude-haiku-5-5");
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["system"], req.system);
    assert_eq!(body["messages"][0]["role"], "user");
    assert_eq!(body["messages"][0]["content"], req.user);
    assert_eq!(body["output_config"]["format"]["type"], "json_schema");
    assert_eq!(body["output_config"]["format"]["schema"], req.schema);
    assert!(body.get("tools").is_none() && body.get("tool_choice").is_none());
    assert!(!sent.body.contains(KEY), "the key travels in a header only");
}

#[test]
fn anthropic_refusals_and_empty_answers_are_not_reviews() {
    let refusal = json!({"content": [], "stop_reason": "refusal"}).to_string();
    let cut = json!({"content": [], "stop_reason": "max_tokens"}).to_string();
    for body in [refusal, cut] {
        let server = Server::start(move |_| Reply::json(200, &body.clone()));
        let req = request(ProviderKind::Anthropic, "claude-haiku-5-5", None);
        assert!(matches!(
            complete(&provider_for(&server), &req, Some(KEY)),
            Err(AiError::BadResponse(_))
        ));
    }
}

#[test]
fn anthropic_lists_models_across_pages() {
    let server = Server::start(|r| {
        if r.target.contains("after_id=claude-b") {
            Reply::json(200, r#"{"data":[{"id":"claude-c"}],"has_more":false}"#)
        } else {
            Reply::json(
                200,
                r#"{"data":[{"id":"claude-b"},{"id":"claude-a"}],"has_more":true,"last_id":"claude-b"}"#,
            )
        }
    });
    let config = request(ProviderKind::Anthropic, "m", None).config;
    let models = provider_for(&server)
        .list_models(&config, Some(&Secret::new(KEY)), &CancelToken::default())
        .unwrap();
    assert_eq!(models, ["claude-a", "claude-b", "claude-c"]);
    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].target.starts_with("/v1/models?limit=1000"));
    assert_eq!(requests[0].header("x-api-key"), Some(KEY));
}

// ---- Gemini ----

#[test]
fn gemini_sends_the_documented_request_and_skips_thought_parts() {
    let answer = json!({"candidates": [{
        "content": {"parts": [{"text": "thinking...", "thought": true}, {"text": ANSWER}]},
        "finishReason": "STOP"
    }]})
    .to_string();
    let server = Server::start(move |_| Reply::json(200, &answer.clone()));
    let req = request(ProviderKind::Gemini, "gemini-3.5-flash-lite", None);
    assert_eq!(
        complete(&provider_for(&server), &req, Some(KEY)).unwrap(),
        ANSWER
    );

    let sent = &server.requests()[0];
    assert_eq!(
        sent.target,
        "/v1beta/models/gemini-3.5-flash-lite:generateContent"
    );
    assert_eq!(sent.header("x-goog-api-key"), Some(KEY));
    assert!(!sent.target.contains(KEY), "never in the URL");
    let body = sent.json();
    assert_eq!(body["systemInstruction"]["parts"][0]["text"], req.system);
    assert_eq!(body["contents"][0]["role"], "user");
    assert_eq!(body["contents"][0]["parts"][0]["text"], req.user);
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert_eq!(body["generationConfig"]["responseJsonSchema"], req.schema);
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 4096);
}

#[test]
fn gemini_blocked_prompts_and_odd_model_names_are_rejected() {
    let blocked = json!({"promptFeedback": {"blockReason": "SAFETY"}}).to_string();
    let server = Server::start(move |_| Reply::json(200, &blocked.clone()));
    let req = request(ProviderKind::Gemini, "gemini-3.5-flash-lite", None);
    assert!(matches!(
        complete(&provider_for(&server), &req, Some(KEY)),
        Err(AiError::BadResponse(m)) if m.contains("SAFETY")
    ));
    let before = server.requests().len();
    for model in ["a/b", "m?x=1", "m#frag", "", "../models"] {
        let req = request(ProviderKind::Gemini, model, None);
        assert!(matches!(
            complete(&provider_for(&server), &req, Some(KEY)),
            Err(AiError::BadResponse(_))
        ));
    }
    assert_eq!(server.requests().len(), before, "nothing was sent for them");
}

#[test]
fn gemini_lists_only_generate_content_models_without_the_prefix() {
    let server = Server::start(|_| {
        Reply::json(
            200,
            r#"{"models":[
                {"name":"models/gemini-3.5-flash-lite","supportedGenerationMethods":["generateContent"]},
                {"name":"models/text-embedding-9","supportedGenerationMethods":["embedContent"]},
                {"name":"models/gemini-3.8-flash","supportedGenerationMethods":["generateContent","countTokens"]}
            ]}"#,
        )
    });
    let config = request(ProviderKind::Gemini, "m", None).config;
    let models = provider_for(&server)
        .list_models(&config, Some(&Secret::new(KEY)), &CancelToken::default())
        .unwrap();
    assert_eq!(models, ["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
    assert!(
        server.requests()[0]
            .target
            .starts_with("/v1beta/models?pageSize=1000")
    );
}

// ---- OpenAI ----

#[test]
fn openai_sends_the_documented_request_and_reads_output_text() {
    let answer = json!({"status": "completed", "output": [
        {"type": "reasoning", "summary": []},
        {"type": "message", "role": "assistant",
         "content": [{"type": "output_text", "text": ANSWER, "annotations": []}]}
    ]})
    .to_string();
    let server = Server::start(move |_| Reply::json(200, &answer.clone()));
    let req = request(ProviderKind::OpenAi, "gpt-6-luna", None);
    assert_eq!(
        complete(&provider_for(&server), &req, Some(KEY)).unwrap(),
        ANSWER
    );

    let sent = &server.requests()[0];
    assert_eq!(sent.target, "/v1/responses");
    assert_eq!(
        sent.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    let body = sent.json();
    assert_eq!(body["model"], "gpt-6-luna");
    assert_eq!(body["instructions"], req.system);
    assert_eq!(body["input"], req.user);
    assert_eq!(body["store"], false);
    assert_eq!(body["max_output_tokens"], 4096);
    let format = &body["text"]["format"];
    assert_eq!(format["type"], "json_schema");
    assert_eq!(format["strict"], true);
    assert_eq!(format["schema"], req.schema);
    assert!(format["name"].as_str().is_some_and(|n| !n.is_empty()));
    assert!(!sent.body.contains(KEY));
}

#[test]
fn openai_refusals_are_reported() {
    let refusal = json!({"status": "completed", "output": [{"type": "message",
        "content": [{"type": "refusal", "refusal": "I can't help with that."}]}]})
    .to_string();
    let server = Server::start(move |_| Reply::json(200, &refusal.clone()));
    let req = request(ProviderKind::OpenAi, "gpt-6-luna", None);
    assert!(matches!(
        complete(&provider_for(&server), &req, Some(KEY)),
        Err(AiError::BadResponse(m)) if m.contains("declined")
    ));
}

#[test]
fn openai_lists_text_models_only() {
    let server = Server::start(|_| {
        Reply::json(
            200,
            r#"{"data":[{"id":"gpt-6-luna"},{"id":"text-embedding-9"},{"id":"whisper-2"},{"id":"gpt-6.1-sol"}]}"#,
        )
    });
    let config = request(ProviderKind::OpenAi, "m", None).config;
    let models = provider_for(&server)
        .list_models(&config, Some(&Secret::new(KEY)), &CancelToken::default())
        .unwrap();
    assert_eq!(models, ["gpt-6-luna", "gpt-6.1-sol"]);
}

// ---- Ollama ----

#[test]
fn ollama_chat_uses_the_schema_as_format_without_streaming_and_without_a_key() {
    let answer = json!({"model": "llama3.2", "message": {"role": "assistant", "content": ANSWER},
        "done": true})
    .to_string();
    let server = Server::start(move |_| Reply::json(200, &answer.clone()));
    let req = request(ProviderKind::Ollama, "llama3.2", Some(&server.url()));
    assert_eq!(
        complete(&HttpAiProvider::new(), &req, None).unwrap(),
        ANSWER
    );

    let sent = &server.requests()[0];
    assert_eq!(sent.target, "/api/chat");
    assert_eq!(sent.header("authorization"), None);
    assert_eq!(sent.header("x-api-key"), None);
    let body = sent.json();
    assert_eq!(body["stream"], false);
    assert_eq!(body["format"], req.schema);
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["content"], req.user);
    assert_eq!(body["model"], "llama3.2");
}

#[test]
fn ollama_lists_the_installed_models() {
    let server = Server::start(|_| {
        Reply::json(
            200,
            r#"{"models":[{"name":"qwen3:8b"},{"name":"llama3.2:latest"}]}"#,
        )
    });
    let config = request(ProviderKind::Ollama, "m", Some(&server.url())).config;
    let models = HttpAiProvider::new()
        .list_models(&config, None, &CancelToken::default())
        .unwrap();
    assert_eq!(models, ["llama3.2:latest", "qwen3:8b"]);
    assert_eq!(server.requests()[0].target, "/api/tags");
}

#[test]
fn ollama_reaches_localhost_by_name_after_it_was_checked() {
    let server = Server::start(|_| {
        Reply::json(
            200,
            r#"{"message":{"content":"{\"summary\":\"hi\"}"},"done":true}"#,
        )
    });
    let url = format!("http://localhost:{}", server.addr.port());
    let req = request(ProviderKind::Ollama, "llama3.2", Some(&url));
    assert!(complete(&HttpAiProvider::new(), &req, None).is_ok());
    assert_eq!(server.requests().len(), 1);
}

#[test]
fn ollama_remote_hosts_are_rejected_over_http_and_https_without_any_connection() {
    let probe = Server::start(|_| Reply::json(200, "{}"));
    let urls = [
        "http://example.com:11434".to_owned(),
        "https://example.com".to_owned(),
        "http://192.168.1.20:11434".to_owned(),
        "https://10.0.0.5:11434".to_owned(),
        format!("http://localhost@example.com:{}", probe.addr.port()),
        "http://localhost.example.com:11434".to_owned(),
    ];
    let started = Instant::now();
    for url in urls {
        let req = request(ProviderKind::Ollama, "llama3.2", Some(&url));
        assert_eq!(
            complete(&HttpAiProvider::new(), &req, None),
            Err(AiError::RemoteHostRejected),
            "{url}"
        );
        assert_eq!(
            HttpAiProvider::new().list_models(&req.config, None, &CancelToken::default()),
            Err(AiError::RemoteHostRejected),
            "{url}"
        );
    }
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "rejected before any network wait"
    );
    assert!(probe.requests().is_empty());
}

// ---- errors, limits and cancellation ----

#[test]
fn http_errors_become_clear_ai_errors() {
    let server = Server::start(|r| match r.target.as_str() {
        "/v1/messages" => {
            Reply::json(429, r#"{"error":{"message":"slow down"}}"#).header("retry-after", "42")
        }
        "/v1/responses" => Reply::json(401, r#"{"error":{"message":"bad key"}}"#),
        _ => Reply::json(
            500,
            &json!({"error": {"message": format!("boom while using {KEY}\nplease retry")}})
                .to_string(),
        ),
    });
    let provider = provider_for(&server);
    assert_eq!(
        complete(
            &provider,
            &request(ProviderKind::Anthropic, "m", None),
            Some(KEY)
        ),
        Err(AiError::RateLimited {
            retry_after_secs: Some(42)
        })
    );
    assert_eq!(
        complete(
            &provider,
            &request(ProviderKind::OpenAi, "m", None),
            Some(KEY)
        ),
        Err(AiError::Unauthorized)
    );
    let error = complete(
        &provider,
        &request(ProviderKind::Gemini, "m", None),
        Some(KEY),
    )
    .unwrap_err();
    let AiError::Provider { status, message } = &error else {
        panic!("expected a provider error, got {error:?}");
    };
    assert_eq!(*status, 500);
    assert!(message.contains("boom while using ***") && message.contains("please retry"));
    assert!(
        !format!("{error:?} {error}").contains(KEY),
        "the key never shows in errors"
    );
    assert!(error.to_string().contains("HTTP 500"));
}

#[test]
fn rate_limit_message_mentions_429() {
    let text = AiError::RateLimited {
        retry_after_secs: None,
    }
    .to_string();
    assert!(text.contains("429"));
    assert!(AiError::Offline.to_string().contains("internet connection"));
}

#[test]
fn a_missing_key_is_unauthorized_without_any_request() {
    let server = Server::start(|_| Reply::json(200, "{}"));
    let provider = provider_for(&server);
    for kind in [
        ProviderKind::Anthropic,
        ProviderKind::Gemini,
        ProviderKind::OpenAi,
    ] {
        assert_eq!(
            complete(&provider, &request(kind, "m", None), None),
            Err(AiError::Unauthorized)
        );
    }
    assert!(server.requests().is_empty());
}

#[test]
fn nobody_listening_means_offline() {
    let provider = HttpAiProvider::new().with_endpoints(Endpoints {
        anthropic: closed_port_url(),
        gemini: closed_port_url(),
        openai: closed_port_url(),
    });
    let req = request(ProviderKind::Anthropic, "claude-haiku-5-5", None);
    assert_eq!(complete(&provider, &req, Some(KEY)), Err(AiError::Offline));
    let local = request(ProviderKind::Ollama, "llama3.2", Some(&closed_port_url()));
    assert_eq!(complete(&provider, &local, None), Err(AiError::Offline));
}

#[test]
fn a_slow_provider_times_out() {
    let server = Server::start(|_| Reply::json(200, &anthropic_ok()).after(Duration::from_secs(3)));
    let provider = fast(provider_for(&server), 300);
    let started = Instant::now();
    let result = complete(
        &provider,
        &request(ProviderKind::Anthropic, "m", None),
        Some(KEY),
    );
    assert_eq!(result, Err(AiError::Timeout));
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn cancelling_returns_at_once_and_discards_the_late_answer() {
    let server = Server::start(|_| Reply::json(200, &anthropic_ok()).after(Duration::from_secs(3)));
    let provider = provider_for(&server);
    let cancel = CancelToken::default();
    let started = Instant::now();
    let result = std::thread::scope(|scope| {
        let call = scope.spawn(|| {
            provider.complete(
                &request(ProviderKind::Anthropic, "m", None),
                Some(&Secret::new(KEY)),
                &cancel,
            )
        });
        std::thread::sleep(Duration::from_millis(150));
        cancel.cancel();
        call.join().unwrap()
    });
    assert_eq!(result, Err(AiError::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(2));

    // A token cancelled beforehand never even connects.
    let before = server.requests().len();
    let token = CancelToken::default();
    token.cancel();
    assert_eq!(
        provider.complete(
            &request(ProviderKind::Anthropic, "m", None),
            Some(&Secret::new(KEY)),
            &token
        ),
        Err(AiError::Cancelled)
    );
    assert_eq!(server.requests().len(), before);
}

#[test]
fn redirects_are_never_followed() {
    let other = Server::start(|_| Reply::json(200, &anthropic_ok()));
    let target = format!("{}/stolen", other.url());
    let server = Server::start(move |_| Reply::json(302, "").header("location", &target));
    let result = complete(
        &provider_for(&server),
        &request(ProviderKind::Anthropic, "m", None),
        Some(KEY),
    );
    assert!(
        matches!(result, Err(AiError::Provider { status: 302, .. })),
        "{result:?}"
    );
    assert!(other.requests().is_empty(), "the key header never left");
}

#[test]
fn an_oversized_answer_is_refused() {
    let big = "x".repeat(2 * 1024 * 1024);
    let server = Server::start(move |_| Reply::json(200, &big.clone()));
    let result = complete(
        &provider_for(&server),
        &request(ProviderKind::Anthropic, "m", None),
        Some(KEY),
    );
    assert!(matches!(result, Err(AiError::BadResponse(m)) if m.contains("too large")));
}

#[test]
fn defaults_match_the_documented_timeouts() {
    assert_eq!(adapters_ai::CLOUD_TIMEOUT, Duration::from_secs(60));
    assert_eq!(adapters_ai::LOCAL_TIMEOUT, Duration::from_secs(180));
}
