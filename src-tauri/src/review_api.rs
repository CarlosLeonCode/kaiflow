//! Use cases behind the weekly review and AI commands, expressed on `AppState` like `api.rs`.
//! API keys only ever go in (`ai_set_key`); nothing here returns one.

use application::review::MondayReview;

use crate::composition::AppState;
use crate::error::AppError;
use crate::ipc::ai_dto::{
    AiProviderDto, AiReviewDto, AiSettingsDto, AiSettingsPatchDto, ReviewPreviewDto,
    WeeklyReviewDto,
};

impl AppState {
    fn ai_settings_view(&self) -> Result<AiSettingsDto, AppError> {
        Ok(AiSettingsDto::new(
            &self.review.settings()?,
            self.review.secret_availability(),
        ))
    }

    pub fn ai_settings(&self) -> Result<AiSettingsDto, AppError> {
        self.ai_settings_view()
    }

    pub fn ai_settings_update(&self, patch: AiSettingsPatchDto) -> Result<AiSettingsDto, AppError> {
        self.review.update_settings(&patch.into(), self.now())?;
        self.ai_settings_view()
    }

    pub fn ai_set_key(
        &self,
        provider: AiProviderDto,
        key: &str,
    ) -> Result<AiSettingsDto, AppError> {
        self.review.set_key(provider.into(), key)?;
        self.ai_settings_view()
    }

    pub fn ai_delete_key(&self, provider: AiProviderDto) -> Result<AiSettingsDto, AppError> {
        self.review.delete_key(provider.into())?;
        self.ai_settings_view()
    }

    pub fn ai_has_key(&self, provider: AiProviderDto) -> Result<bool, AppError> {
        Ok(self.review.has_key(provider.into())?)
    }

    pub fn ai_test(&self, provider: AiProviderDto) -> Result<u32, AppError> {
        let models = self.review.test(provider.into())?;
        Ok(u32::try_from(models).unwrap_or(u32::MAX))
    }

    pub fn ai_models_list(&self, provider: AiProviderDto) -> Result<Vec<String>, AppError> {
        Ok(self.review.models(provider.into())?)
    }

    pub fn review_get(&self, weeks_ago: u32) -> Result<WeeklyReviewDto, AppError> {
        Ok(self.review.summary(weeks_ago, self.now())?.into())
    }

    pub fn review_note_set(&self, first_day: i64, note: &str) -> Result<(), AppError> {
        Ok(self.review.set_note(first_day, note)?)
    }

    pub fn review_preview(
        &self,
        weeks_ago: u32,
        include_titles: bool,
        language: &str,
    ) -> Result<ReviewPreviewDto, AppError> {
        Ok(self
            .review
            .preview(weeks_ago, include_titles, language, self.now())?
            .into())
    }

    pub fn review_run(&self, preview_id: &str) -> Result<AiReviewDto, AppError> {
        Ok(self.review.run(preview_id, self.now())?.into())
    }

    pub fn review_cancel(&self) {
        self.review.cancel();
    }

    pub fn ai_reviews_list(&self) -> Result<Vec<AiReviewDto>, AppError> {
        Ok(self.review.history()?.into_iter().map(Into::into).collect())
    }

    pub fn ai_reviews_delete(&self, id: i64) -> Result<(), AppError> {
        Ok(self.review.delete(id)?)
    }

    pub fn ai_reviews_prepare_delete_all(&self) -> String {
        self.review.prepare_delete_all(self.now())
    }

    pub fn ai_reviews_delete_all(&self, token: &str) -> Result<u32, AppError> {
        let deleted = self.review.delete_all(token, self.now())?;
        Ok(u32::try_from(deleted).unwrap_or(u32::MAX))
    }

    /// The scheduled Monday review (a no-op unless the user switched it on).
    pub fn run_monday_review(&self) -> MondayReview {
        self.review.run_monday_review("English", self.now())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use application::ai::ProviderKind;
    use application::fakes::{FakeAi, FakePermission, FakePower, FakeSecrets, FakeWindow};
    use application::fakes::{RecordingNotifier, RecordingSink};
    use domain::PermissionState;

    use super::*;
    use crate::composition::{AiPorts, Providers, compose};
    use crate::ipc::ai_dto::{AiProviderPatchDto, ReviewStatusDto};
    use crate::ipc::dto::RangeDto;

    struct Rig {
        state: AppState,
        ai: FakeAi,
        secrets: FakeSecrets,
        _dir: tempfile::TempDir,
    }

    fn rig_with(secrets: FakeSecrets) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let ai = FakeAi::default();
        let state = compose(
            &dir.path().join("kaiflow.db"),
            Box::new(RecordingSink::default()),
            AppState::default_shortcut(),
            Providers {
                window: Box::new(FakeWindow::default()),
                power: Box::new(FakePower::default()),
                permission: Arc::new(FakePermission::new(PermissionState::Granted)),
                notifier: Box::new(RecordingNotifier::default()),
                idle_threshold: adapters_common::idle::IdleThreshold::default(),
                sampler: None,
                display_session: None,
            },
            AiPorts {
                provider: Arc::new(ai.clone()),
                secrets: Arc::new(secrets.clone()),
            },
        )
        .unwrap();
        Rig {
            state,
            ai,
            secrets,
            _dir: dir,
        }
    }

    fn rig() -> Rig {
        rig_with(FakeSecrets::default())
    }

    fn switch_on(rig: &Rig, provider: AiProviderDto) {
        rig.state
            .ai_settings_update(AiSettingsPatchDto {
                selected: Some(provider),
                include_titles: None,
                monday_review: None,
                provider: Some(AiProviderPatchDto {
                    provider,
                    enabled: Some(true),
                    model: None,
                    base_url: None,
                }),
            })
            .unwrap();
    }

    const ANSWER: &str =
        r#"{"summary":"Calm week.","wins":["x"],"patterns":[],"goal_misses":[],"suggestions":[]}"#;

    #[test]
    fn the_review_opens_without_ai_and_nothing_is_sent_before_the_opt_in() {
        let rig = rig();
        let review = rig.state.review_get(0).unwrap();
        assert_eq!(review.weeks_ago, 0);
        assert_eq!(review.dashboard.total_ms, 0);
        assert!(review.reviews.is_empty() && review.note.is_empty());

        assert_eq!(
            rig.state.ai_models_list(AiProviderDto::Anthropic),
            Err(AppError::AiNotEnabled)
        );
        assert_eq!(
            rig.state.review_preview(0, false, "English"),
            Err(AppError::AiNotEnabled)
        );
        assert_eq!(
            rig.state.review_run("nope"),
            Err(AppError::NotFound),
            "a run needs a preview"
        );
        assert_eq!(
            rig.state.ai_test(AiProviderDto::Ollama),
            Err(AppError::AiNotEnabled)
        );
        assert_eq!(rig.ai.traffic(), 0);
        assert_eq!(rig.secrets.touched(), 0, "the keychain was never opened");
        rig.state.shutdown();
    }

    #[test]
    fn settings_never_carry_a_key_and_follow_the_keychain_state() {
        let rig = rig();
        let before = rig.state.ai_settings().unwrap();
        assert!(before.secret_store.available);
        let anthropic = &before.providers[0];
        assert_eq!(anthropic.provider, AiProviderDto::Anthropic);
        assert_eq!(anthropic.model, "claude-haiku-5-5");
        assert!(!anthropic.enabled && !anthropic.has_key);
        assert!(
            before.providers.iter().find(|p| p.local).unwrap().has_key,
            "Ollama needs none"
        );

        let after = rig
            .state
            .ai_set_key(AiProviderDto::Anthropic, "sk-ant-api-key-123")
            .unwrap();
        assert!(after.providers[0].has_key);
        let json = serde_json::to_string(&after).unwrap();
        assert!(!json.contains("sk-ant-api-key-123"), "no DTO returns a key");
        assert!(rig.state.ai_has_key(AiProviderDto::Anthropic).unwrap());
        assert_eq!(
            rig.secrets.stored(ProviderKind::Anthropic).as_deref(),
            Some("sk-ant-api-key-123")
        );
        let after = rig.state.ai_delete_key(AiProviderDto::Anthropic).unwrap();
        assert!(!after.providers[0].has_key);
        rig.state.shutdown();
    }

    #[test]
    fn a_run_stores_the_review_in_the_history_and_it_can_be_deleted() {
        let rig = rig();
        rig.state
            .ai_set_key(AiProviderDto::Anthropic, "sk-ant-api-key-123")
            .unwrap();
        switch_on(&rig, AiProviderDto::Anthropic);
        rig.ai.answer_with(Ok(ANSWER.into()));

        let preview = rig.state.review_preview(0, false, "English").unwrap();
        assert!(!preview.included_titles && preview.title_count == 0);
        assert!(preview.user.contains("<data>"));
        let review = rig.state.review_run(&preview.id).unwrap();
        assert_eq!(review.status, ReviewStatusDto::Ok);
        assert_eq!(review.output.as_ref().unwrap().summary, "Calm week.");

        let week = rig.state.review_get(0).unwrap();
        assert_eq!(week.reviews.len(), 1);
        assert_eq!(rig.state.ai_reviews_list().unwrap().len(), 1);

        // Delete all needs the token.
        assert_eq!(
            rig.state.ai_reviews_delete_all("forged"),
            Err(AppError::ConfirmationRequired)
        );
        let token = rig.state.ai_reviews_prepare_delete_all();
        assert_eq!(rig.state.ai_reviews_delete_all(&token).unwrap(), 1);
        assert!(rig.state.ai_reviews_list().unwrap().is_empty());
        assert_eq!(
            rig.state.ai_reviews_delete(review.id),
            Err(AppError::NotFound)
        );
        rig.state.shutdown();
    }

    #[test]
    fn failures_have_a_reason_and_a_readable_message() {
        let rig = rig();
        rig.state
            .ai_set_key(AiProviderDto::OpenAi, "sk-openai-key-123")
            .unwrap();
        switch_on(&rig, AiProviderDto::OpenAi);
        rig.ai
            .answer_with(Err(application::ai::AiError::RateLimited {
                retry_after_secs: None,
            }));
        let preview = rig.state.review_preview(0, false, "English").unwrap();
        match rig.state.review_run(&preview.id) {
            Err(AppError::Ai { reason, message }) => {
                assert_eq!(reason, crate::ipc::ai_dto::AiFailureDto::RateLimited);
                assert!(message.contains("429"));
            }
            other => panic!("expected an AI failure, got {other:?}"),
        }
        assert!(rig.state.ai_reviews_list().unwrap().is_empty());
        rig.state.shutdown();
    }

    #[test]
    fn without_a_secure_store_keys_are_refused_with_a_clear_error() {
        let rig = rig_with(FakeSecrets::unavailable("no Secret Service"));
        let settings = rig.state.ai_settings().unwrap();
        assert!(!settings.secret_store.available);
        assert!(settings.secret_store.reason.is_some());
        assert!(matches!(
            rig.state
                .ai_set_key(AiProviderDto::Anthropic, "sk-ant-api-key-123"),
            Err(AppError::SecretStoreUnavailable { .. })
        ));
        assert!(matches!(
            rig.state.ai_settings_update(AiSettingsPatchDto {
                selected: None,
                include_titles: None,
                monday_review: None,
                provider: Some(AiProviderPatchDto {
                    provider: AiProviderDto::Gemini,
                    enabled: Some(true),
                    model: None,
                    base_url: None,
                }),
            }),
            Err(AppError::SecretStoreUnavailable { .. })
        ));
        rig.state.shutdown();
    }

    #[test]
    fn reviews_travel_in_backups_and_keys_never_do() {
        let rig = rig();
        rig.state
            .ai_set_key(AiProviderDto::Anthropic, "sk-ant-api-key-123")
            .unwrap();
        switch_on(&rig, AiProviderDto::Anthropic);
        rig.ai.answer_with(Ok(ANSWER.into()));
        let preview = rig.state.review_preview(0, false, "English").unwrap();
        rig.state.review_run(&preview.id).unwrap();

        let now = rig.state.now().0;
        let bytes = rig
            .state
            .data
            .export_json(
                application::queries::Range {
                    from: domain::UtcMs(0),
                    to: domain::UtcMs(now + 10 * 86_400_000),
                },
                rig.state.now(),
                "UTC+00:00",
            )
            .unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("\"ai_reviews\""));
        assert!(text.contains("Calm week."));
        assert!(
            !text.contains("sk-ant-api-key-123"),
            "the key is not in the export"
        );
        assert!(
            !text.contains("monday_review"),
            "the opt-in is not exported either"
        );
        let _ = RangeDto { from: 0, to: 1 };
        rig.state.shutdown();
    }

    #[test]
    fn the_monday_review_is_off_until_the_user_enables_it() {
        let rig = rig();
        rig.state
            .ai_set_key(AiProviderDto::Anthropic, "sk-ant-api-key-123")
            .unwrap();
        switch_on(&rig, AiProviderDto::Anthropic);
        assert_eq!(rig.state.run_monday_review(), MondayReview::NotDue);
        assert_eq!(rig.ai.traffic(), 0);
        rig.state.shutdown();
    }
}
