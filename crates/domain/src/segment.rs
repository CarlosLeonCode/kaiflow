use crate::time::UtcMs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SegmentId(pub i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CategoryId(pub i64);

/// Why a segment ended (R1.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EndReason {
    FocusChange,
    Idle,
    Sleep,
    Lock,
    Pause,
    Stop,
    Shutdown,
    Recovered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentSource {
    Tracked,
    IdleAssigned,
}

/// User decision for an idle gap; single enum shared by domain, DB and IPC.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdleResolution {
    Discard,
    AssignPrevious,
    AssignCategory(CategoryId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub id: SegmentId,
    pub started_at: UtcMs,
    pub ended_at: Option<UtcMs>,
    pub heartbeat_at: UtcMs,
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub end_reason: Option<EndReason>,
    pub source: SegmentSource,
    /// Manual assignment only; rules are resolved at query time (R9.2).
    pub category_id: Option<CategoryId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentError {
    EndsBeforeStart,
    TrackedWithoutApp,
    AssignedWithoutEndReasonIdle,
    AssignedWithoutAppOrCategory,
}

impl Segment {
    /// Mirrors the SQL CHECKs (R1.1 as amended by A1).
    pub fn validate(&self) -> Result<(), SegmentError> {
        if self.ended_at.is_some_and(|end| end < self.started_at) {
            return Err(SegmentError::EndsBeforeStart);
        }
        let has_app = self.app_id.is_some();
        match self.source {
            SegmentSource::Tracked if !has_app || self.app_name.is_none() => {
                Err(SegmentError::TrackedWithoutApp)
            }
            SegmentSource::IdleAssigned if self.end_reason != Some(EndReason::Idle) => {
                Err(SegmentError::AssignedWithoutEndReasonIdle)
            }
            SegmentSource::IdleAssigned if !has_app && self.category_id.is_none() => {
                Err(SegmentError::AssignedWithoutAppOrCategory)
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(source: SegmentSource) -> Segment {
        Segment {
            id: SegmentId(1),
            started_at: UtcMs(10),
            ended_at: Some(UtcMs(20)),
            heartbeat_at: UtcMs(20),
            app_id: Some("com.a".into()),
            app_name: Some("A".into()),
            window_title: None,
            end_reason: Some(EndReason::FocusChange),
            source,
            category_id: None,
        }
    }

    #[test]
    fn tracked_requires_app() {
        assert_eq!(base(SegmentSource::Tracked).validate(), Ok(()));
        let mut s = base(SegmentSource::Tracked);
        s.app_id = None;
        assert_eq!(s.validate(), Err(SegmentError::TrackedWithoutApp));
        let mut s = base(SegmentSource::Tracked);
        s.app_name = None;
        assert_eq!(s.validate(), Err(SegmentError::TrackedWithoutApp));
    }

    #[test]
    fn open_segment_is_valid_but_negative_duration_is_not() {
        let mut s = base(SegmentSource::Tracked);
        s.ended_at = None;
        assert_eq!(s.validate(), Ok(()));
        s.ended_at = Some(UtcMs(9));
        assert_eq!(s.validate(), Err(SegmentError::EndsBeforeStart));
    }

    #[test]
    fn assign_previous_keeps_app_and_idle_reason() {
        let mut s = base(SegmentSource::IdleAssigned);
        assert_eq!(
            s.validate(),
            Err(SegmentError::AssignedWithoutEndReasonIdle)
        );
        s.end_reason = Some(EndReason::Idle);
        assert_eq!(s.validate(), Ok(()));
    }

    #[test]
    fn assign_category_allows_null_app_only_with_category() {
        let mut s = base(SegmentSource::IdleAssigned);
        s.end_reason = Some(EndReason::Idle);
        s.app_id = None;
        s.app_name = None;
        assert_eq!(
            s.validate(),
            Err(SegmentError::AssignedWithoutAppOrCategory)
        );
        s.category_id = Some(CategoryId(7));
        assert_eq!(s.validate(), Ok(()));
    }
}
