use regex::Regex;

use crate::segment::{CategoryId, Segment};

/// Fixed system category ("Sin categoria"); not deletable (design section 7).
pub const UNCATEGORIZED: CategoryId = CategoryId(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Category {
    pub id: CategoryId,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
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
pub struct CategoryRule {
    pub id: i64,
    pub category_id: CategoryId,
    pub kind: RuleKind,
    pub priority: i32,
}

impl CategoryRule {
    /// Validates the pattern before it can ever be persisted (R9.4).
    pub fn title_pattern(
        id: i64,
        category_id: CategoryId,
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
            category_id,
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

/// Manual assignment > title pattern > bundle id > `UNCATEGORIZED` (R9.3).
/// Within a tier the highest `priority` wins, then the lowest rule `id`.
pub fn categorize(segment: &Segment, rules: &[CategoryRule]) -> CategoryId {
    if let Some(manual) = segment.category_id {
        return manual;
    }
    let best = |title_tier: bool| {
        rules
            .iter()
            .filter(|r| matches!(r.kind, RuleKind::TitlePattern { .. }) == title_tier)
            .filter(|r| r.matches(segment))
            .min_by_key(|r| (std::cmp::Reverse(r.priority), r.id))
            .map(|r| r.category_id)
    };
    best(true).or_else(|| best(false)).unwrap_or(UNCATEGORIZED)
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
            category_id: manual.map(CategoryId),
        }
    }

    fn app_rule(id: i64, cat: i64, bundle: &str, prio: i32) -> CategoryRule {
        CategoryRule {
            id,
            category_id: CategoryId(cat),
            kind: RuleKind::App(bundle.into()),
            priority: prio,
        }
    }

    fn title_rule(id: i64, cat: i64, pat: &str, app: Option<&str>, prio: i32) -> CategoryRule {
        CategoryRule::title_pattern(id, CategoryId(cat), pat, app.map(Into::into), prio).unwrap()
    }

    #[test]
    fn no_match_is_uncategorized() {
        assert_eq!(
            categorize(&seg("x", None, None), &[app_rule(1, 5, "y", 0)]),
            UNCATEGORIZED
        );
    }

    #[test]
    fn app_rule_matches_bundle() {
        assert_eq!(
            categorize(&seg("slack", None, None), &[app_rule(1, 5, "slack", 0)]),
            CategoryId(5)
        );
    }

    #[test]
    fn title_beats_app_even_with_lower_priority() {
        let rules = [
            app_rule(1, 5, "chrome", 99),
            title_rule(2, 6, "Figma", None, 0),
        ];
        assert_eq!(
            categorize(&seg("chrome", Some("Figma - file"), None), &rules),
            CategoryId(6)
        );
    }

    #[test]
    fn manual_assignment_beats_rules() {
        let rules = [title_rule(1, 6, "Figma", None, 0)];
        assert_eq!(
            categorize(&seg("chrome", Some("Figma"), Some(9)), &rules),
            CategoryId(9)
        );
    }

    #[test]
    fn ties_break_by_priority_then_id() {
        let s = seg("a", None, None);
        assert_eq!(
            categorize(&s, &[app_rule(1, 5, "a", 1), app_rule(2, 6, "a", 2)]),
            CategoryId(6)
        );
        assert_eq!(
            categorize(&s, &[app_rule(3, 5, "a", 1), app_rule(2, 6, "a", 1)]),
            CategoryId(6)
        );
    }

    #[test]
    fn title_rule_scoped_to_app_and_needs_a_title() {
        let rules = [title_rule(1, 6, "doc", Some("word"), 0)];
        assert_eq!(
            categorize(&seg("pages", Some("doc"), None), &rules),
            UNCATEGORIZED
        );
        assert_eq!(categorize(&seg("word", None, None), &rules), UNCATEGORIZED);
        assert_eq!(
            categorize(&seg("word", Some("my doc"), None), &rules),
            CategoryId(6)
        );
    }

    #[test]
    fn invalid_pattern_is_rejected_with_reason() {
        let err = CategoryRule::title_pattern(1, CategoryId(2), "(unclosed", None, 0).unwrap_err();
        assert_eq!(err.pattern, "(unclosed");
        assert!(!err.reason.is_empty());
    }
}
