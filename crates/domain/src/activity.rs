use regex::Regex;

use crate::segment::{ActivityId, Segment};

/// Fixed system activity ("Unassigned"); not deletable (design section 7).
pub const UNASSIGNED: ActivityId = ActivityId(1);

/// How an activity counts toward the focus ratio; `Neutral` is the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Productivity {
    Productive,
    #[default]
    Neutral,
    Distracting,
}

impl Productivity {
    /// Stable storage / wire name (the `productivity` CHECK in migration 0002).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Productive => "productive",
            Self::Neutral => "neutral",
            Self::Distracting => "distracting",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "productive" => Some(Self::Productive),
            "neutral" => Some(Self::Neutral),
            "distracting" => Some(Self::Distracting),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activity {
    pub id: ActivityId,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub productivity: Productivity,
    /// Set when a preset created the activity (opt-in presets); `None` for user-made ones.
    pub preset_key: Option<String>,
}

/// A title pattern could not be compiled (R9.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidPattern {
    pub pattern: String,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub enum RuleKind {
    App(String),
    TitlePattern {
        regex: Regex,
        app_id: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct ActivityRule {
    pub id: i64,
    pub activity_id: ActivityId,
    pub kind: RuleKind,
    pub priority: i32,
}

impl ActivityRule {
    /// Validates the pattern before it can ever be persisted (R9.4).
    pub fn title_pattern(
        id: i64,
        activity_id: ActivityId,
        pattern: &str,
        app_id: Option<String>,
        priority: i32,
    ) -> Result<Self, InvalidPattern> {
        let regex = Regex::new(pattern).map_err(|e| InvalidPattern {
            pattern: pattern.to_owned(),
            reason: e.to_string(),
        })?;
        Ok(Self {
            id,
            activity_id,
            kind: RuleKind::TitlePattern { regex, app_id },
            priority,
        })
    }

    fn matches(&self, segment: &Segment) -> bool {
        match &self.kind {
            RuleKind::App(bundle) => segment.app_id.as_ref() == Some(bundle),
            RuleKind::TitlePattern { regex, app_id } => {
                app_id
                    .as_ref()
                    .is_none_or(|a| segment.app_id.as_ref() == Some(a))
                    && segment
                        .window_title
                        .as_deref()
                        .is_some_and(|t| regex.is_match(t))
            }
        }
    }
}

/// Manual assignment > title pattern > bundle id > `UNASSIGNED` (R9.3).
/// Within a tier the highest `priority` wins, then the lowest rule `id`.
pub fn classify(segment: &Segment, rules: &[ActivityRule]) -> ActivityId {
    if let Some(manual) = segment.activity_id {
        return manual;
    }
    let best = |title_tier: bool| {
        rules
            .iter()
            .filter(|r| matches!(r.kind, RuleKind::TitlePattern { .. }) == title_tier)
            .filter(|r| r.matches(segment))
            .min_by_key(|r| (std::cmp::Reverse(r.priority), r.id))
            .map(|r| r.activity_id)
    };
    best(true).or_else(|| best(false)).unwrap_or(UNASSIGNED)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segment::{EndReason, SegmentId, SegmentSource};
    use crate::time::UtcMs;

    fn seg(app: &str, title: Option<&str>, manual: Option<i64>) -> Segment {
        Segment {
            id: SegmentId(1),
            started_at: UtcMs(0),
            ended_at: Some(UtcMs(1)),
            heartbeat_at: UtcMs(1),
            app_id: Some(app.into()),
            app_name: Some(app.into()),
            window_title: title.map(Into::into),
            end_reason: Some(EndReason::Stop),
            source: SegmentSource::Tracked,
            activity_id: manual.map(ActivityId),
        }
    }

    fn app_rule(id: i64, cat: i64, bundle: &str, prio: i32) -> ActivityRule {
        ActivityRule {
            id,
            activity_id: ActivityId(cat),
            kind: RuleKind::App(bundle.into()),
            priority: prio,
        }
    }

    fn title_rule(id: i64, cat: i64, pat: &str, app: Option<&str>, prio: i32) -> ActivityRule {
        ActivityRule::title_pattern(id, ActivityId(cat), pat, app.map(Into::into), prio).unwrap()
    }

    #[test]
    fn productivity_round_trips_and_defaults_to_neutral() {
        for p in [
            Productivity::Productive,
            Productivity::Neutral,
            Productivity::Distracting,
        ] {
            assert_eq!(Productivity::parse(p.as_str()), Some(p));
        }
        assert_eq!(Productivity::default(), Productivity::Neutral);
        assert_eq!(Productivity::parse("bogus"), None);
    }

    #[test]
    fn no_match_is_unassigned() {
        assert_eq!(
            classify(&seg("x", None, None), &[app_rule(1, 5, "y", 0)]),
            UNASSIGNED
        );
    }

    #[test]
    fn app_rule_matches_bundle() {
        assert_eq!(
            classify(&seg("slack", None, None), &[app_rule(1, 5, "slack", 0)]),
            ActivityId(5)
        );
    }

    #[test]
    fn title_beats_app_even_with_lower_priority() {
        let rules = [
            app_rule(1, 5, "chrome", 99),
            title_rule(2, 6, "Figma", None, 0),
        ];
        assert_eq!(
            classify(&seg("chrome", Some("Figma - file"), None), &rules),
            ActivityId(6)
        );
    }

    #[test]
    fn manual_assignment_beats_rules() {
        let rules = [title_rule(1, 6, "Figma", None, 0)];
        assert_eq!(
            classify(&seg("chrome", Some("Figma"), Some(9)), &rules),
            ActivityId(9)
        );
    }

    #[test]
    fn ties_break_by_priority_then_id() {
        let s = seg("a", None, None);
        assert_eq!(
            classify(&s, &[app_rule(1, 5, "a", 1), app_rule(2, 6, "a", 2)]),
            ActivityId(6)
        );
        assert_eq!(
            classify(&s, &[app_rule(3, 5, "a", 1), app_rule(2, 6, "a", 1)]),
            ActivityId(6)
        );
    }

    #[test]
    fn title_rule_scoped_to_app_and_needs_a_title() {
        let rules = [title_rule(1, 6, "doc", Some("word"), 0)];
        assert_eq!(
            classify(&seg("pages", Some("doc"), None), &rules),
            UNASSIGNED
        );
        assert_eq!(classify(&seg("word", None, None), &rules), UNASSIGNED);
        assert_eq!(
            classify(&seg("word", Some("my doc"), None), &rules),
            ActivityId(6)
        );
    }

    #[test]
    fn invalid_pattern_is_rejected_with_reason() {
        let err = ActivityRule::title_pattern(1, ActivityId(2), "(unclosed", None, 0).unwrap_err();
        assert_eq!(err.pattern, "(unclosed");
        assert!(!err.reason.is_empty());
    }

    mod props {
        use super::*;
        use proptest::prelude::*;

        /// Rules with unique ids (ties are otherwise legitimately order dependent).
        fn rules_strategy() -> impl Strategy<Value = Vec<ActivityRule>> {
            proptest::collection::vec((2i64..10, "[ab]", -3i32..3, any::<bool>()), 0..8).prop_map(
                |specs| {
                    specs
                        .into_iter()
                        .zip(1i64..)
                        .map(|((activity, token, priority, title), id)| {
                            if title {
                                title_rule(id, activity, &token, None, priority)
                            } else {
                                app_rule(id, activity, &token, priority)
                            }
                        })
                        .collect()
                },
            )
        }

        proptest! {
            #[test]
            fn manual_assignment_always_wins(
                manual in 2i64..10,
                rules in rules_strategy(),
            ) {
                prop_assert_eq!(
                    classify(&seg("a", Some("a"), Some(manual)), &rules),
                    ActivityId(manual)
                );
            }

            #[test]
            fn result_is_unassigned_or_an_existing_rule_target(
                rules in rules_strategy(),
            ) {
                let result = classify(&seg("a", Some("b"), None), &rules);
                prop_assert!(
                    result == UNASSIGNED || rules.iter().any(|r| r.activity_id == result)
                );
            }

            #[test]
            fn rule_order_does_not_change_the_result(
                mut rules in rules_strategy(),
            ) {
                let s = seg("a", Some("b"), None);
                let expected = classify(&s, &rules);
                rules.reverse();
                prop_assert_eq!(classify(&s, &rules), expected);
            }
        }
    }
}
