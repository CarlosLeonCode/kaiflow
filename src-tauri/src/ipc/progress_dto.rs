//! Wire types of progress: strokes, levels, streak, seals and the one moment to celebrate.
//! Sources, seals, families and level names travel as snake_case ids the UI maps to its own
//! copy, so no user-facing text comes from here.

use application::ports::StrokeEntry;
use application::progress::{Moment, ProgressSnapshot, SealView};
use domain::{DAILY_CAP, LevelName, LevelProgress, Seal, SealFamily, StrokeSource};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Why strokes were earned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StrokeSourceDto {
    FocusCompleted,
    FocusOnTarget,
    BreakTaken,
    GoalMet,
    LimitRespected,
}

impl From<StrokeSource> for StrokeSourceDto {
    fn from(s: StrokeSource) -> Self {
        match s {
            StrokeSource::FocusCompleted => Self::FocusCompleted,
            StrokeSource::FocusOnTarget => Self::FocusOnTarget,
            StrokeSource::BreakTaken => Self::BreakTaken,
            StrokeSource::GoalMet => Self::GoalMet,
            StrokeSource::LimitRespected => Self::LimitRespected,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LevelNameDto {
    Start,
    Steady,
    Rhythm,
    Flow,
    Craft,
    Mastery,
    Kaizen,
}

impl From<LevelName> for LevelNameDto {
    fn from(n: LevelName) -> Self {
        match n {
            LevelName::Start => Self::Start,
            LevelName::Steady => Self::Steady,
            LevelName::Rhythm => Self::Rhythm,
            LevelName::Flow => Self::Flow,
            LevelName::Craft => Self::Craft,
            LevelName::Mastery => Self::Mastery,
            LevelName::Kaizen => Self::Kaizen,
        }
    }
}

impl From<LevelNameDto> for LevelName {
    fn from(n: LevelNameDto) -> Self {
        match n {
            LevelNameDto::Start => Self::Start,
            LevelNameDto::Steady => Self::Steady,
            LevelNameDto::Rhythm => Self::Rhythm,
            LevelNameDto::Flow => Self::Flow,
            LevelNameDto::Craft => Self::Craft,
            LevelNameDto::Mastery => Self::Mastery,
            LevelNameDto::Kaizen => Self::Kaizen,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SealDto {
    FirstFocus,
    TenSessions,
    TookTheBreak,
    SevenDays,
    ThirtyDays,
    PerfectWeek,
}

impl From<Seal> for SealDto {
    fn from(s: Seal) -> Self {
        match s {
            Seal::FirstFocus => Self::FirstFocus,
            Seal::TenSessions => Self::TenSessions,
            Seal::TookTheBreak => Self::TookTheBreak,
            Seal::SevenDays => Self::SevenDays,
            Seal::ThirtyDays => Self::ThirtyDays,
            Seal::PerfectWeek => Self::PerfectWeek,
        }
    }
}

impl From<SealDto> for Seal {
    fn from(s: SealDto) -> Self {
        match s {
            SealDto::FirstFocus => Self::FirstFocus,
            SealDto::TenSessions => Self::TenSessions,
            SealDto::TookTheBreak => Self::TookTheBreak,
            SealDto::SevenDays => Self::SevenDays,
            SealDto::ThirtyDays => Self::ThirtyDays,
            SealDto::PerfectWeek => Self::PerfectWeek,
        }
    }
}

/// The color family a seal is drawn in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SealFamilyDto {
    Focus,
    Streaks,
    Breaks,
    Goals,
}

impl From<SealFamily> for SealFamilyDto {
    fn from(f: SealFamily) -> Self {
        match f {
            SealFamily::Focus => Self::Focus,
            SealFamily::Streaks => Self::Streaks,
            SealFamily::Breaks => Self::Breaks,
            SealFamily::Goals => Self::Goals,
        }
    }
}

/// One row of today's ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct StrokeEntryDto {
    pub source: StrokeSourceDto,
    /// Granted after the daily cap; 0 once the day was full.
    pub strokes: u32,
    pub at: i64,
}

impl From<StrokeEntry> for StrokeEntryDto {
    fn from(e: StrokeEntry) -> Self {
        Self {
            source: e.source.into(),
            strokes: e.strokes,
            at: e.earned_at.0,
        }
    }
}

/// Today's ensō.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProgressTodayDto {
    pub strokes: u32,
    /// Strokes a day can hold.
    pub cap: u32,
    pub done: bool,
    /// Oldest first.
    pub entries: Vec<StrokeEntryDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProgressLevelDto {
    /// 1-based.
    pub number: u8,
    pub name: LevelNameDto,
    /// All-time strokes.
    pub total: u32,
    /// Strokes earned since reaching this level.
    pub into_level: u32,
    /// Strokes between this level and the next; `null` at the last level.
    pub span: Option<u32>,
    /// `null` at the last level.
    pub next_name: Option<LevelNameDto>,
}

impl From<LevelProgress> for ProgressLevelDto {
    fn from(p: LevelProgress) -> Self {
        Self {
            number: p.level.number,
            name: p.level.name.into(),
            total: saturating_u32(p.total),
            into_level: saturating_u32(p.into_level()),
            span: p.span().map(saturating_u32),
            next_name: p.next.map(|next| next.name.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProgressStreakDto {
    pub current: u32,
    pub best: u32,
    /// Whether each of the last seven days holds strokes, oldest first, ending today.
    pub last7: Vec<bool>,
}

/// A seal, earned or locked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SealViewDto {
    pub id: SealDto,
    pub family: SealFamilyDto,
    pub earned: bool,
    pub earned_at: Option<i64>,
    /// The user acknowledged it; always `false` while locked.
    pub seen: bool,
    /// Progress toward `target`, capped at it.
    pub current: u32,
    pub target: u32,
}

impl From<SealView> for SealViewDto {
    fn from(v: SealView) -> Self {
        Self {
            id: v.seal.into(),
            family: v.seal.family().into(),
            earned: v.earned,
            earned_at: v.earned_at.map(|t| t.0),
            seen: v.seen,
            current: v.current,
            target: v.target,
        }
    }
}

/// The one thing to celebrate, shown until dismissed with `dismiss_moment`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MomentDto {
    /// A seal earned and not seen yet.
    Seal { seal: SealDto },
    /// A level reached and not acknowledged yet.
    Level { number: u8, name: LevelNameDto },
    /// The ensō of local day `day` (days since 1970-01-01; today when reported) is full.
    /// Dismissing it acknowledges that day, whenever the dismissal happens.
    DayDone { day: i64 },
}

impl From<Moment> for MomentDto {
    fn from(m: Moment) -> Self {
        match m {
            Moment::Seal(seal) => Self::Seal { seal: seal.into() },
            Moment::Level { number, name } => Self::Level {
                number,
                name: name.into(),
            },
            Moment::DayDone { day } => Self::DayDone { day },
        }
    }
}

impl From<MomentDto> for Moment {
    fn from(m: MomentDto) -> Self {
        match m {
            MomentDto::Seal { seal } => Self::Seal(seal.into()),
            MomentDto::Level { number, name } => Self::Level {
                number,
                name: name.into(),
            },
            MomentDto::DayDone { day } => Self::DayDone { day },
        }
    }
}

/// Everything the progress views show, in one call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProgressDto {
    /// The `progress_enabled` setting. Strokes keep counting while it is off; only the UI
    /// hides them.
    pub enabled: bool,
    pub today: ProgressTodayDto,
    pub level: ProgressLevelDto,
    pub streak: ProgressStreakDto,
    /// Every seal, earned or locked, in a fixed order.
    pub seals: Vec<SealViewDto>,
    pub moment: Option<MomentDto>,
}

impl ProgressDto {
    pub fn new(enabled: bool, snapshot: ProgressSnapshot, moment: Option<Moment>) -> Self {
        Self {
            enabled,
            today: ProgressTodayDto {
                strokes: snapshot.today_total,
                cap: DAILY_CAP,
                done: snapshot.day_done,
                entries: snapshot.entries.into_iter().map(Into::into).collect(),
            },
            level: snapshot.level.into(),
            streak: ProgressStreakDto {
                current: snapshot.streak.current,
                best: snapshot.streak.best,
                last7: snapshot.last7.to_vec(),
            },
            seals: snapshot.seals.into_iter().map(Into::into).collect(),
            moment: moment.map(Into::into),
        }
    }
}

fn saturating_u32(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_moments_serialize_as_snake_case() {
        let json = |m: MomentDto| serde_json::to_value(m).unwrap();
        assert_eq!(
            json(MomentDto::Seal {
                seal: SealDto::TookTheBreak
            }),
            serde_json::json!({ "kind": "seal", "seal": "took_the_break" })
        );
        assert_eq!(
            json(MomentDto::Level {
                number: 4,
                name: LevelNameDto::Flow
            }),
            serde_json::json!({ "kind": "level", "number": 4, "name": "flow" })
        );
        assert_eq!(
            json(MomentDto::DayDone { day: 20_415 }),
            serde_json::json!({ "kind": "day_done", "day": 20_415 })
        );
        let back: MomentDto =
            serde_json::from_value(json(MomentDto::DayDone { day: 20_415 })).unwrap();
        assert_eq!(Moment::from(back), Moment::DayDone { day: 20_415 });
    }

    #[test]
    fn dto_ids_match_the_domain_names() {
        let id = |v: serde_json::Value| v.as_str().unwrap().to_owned();
        for seal in Seal::ALL {
            assert_eq!(
                id(serde_json::to_value(SealDto::from(seal)).unwrap()),
                seal.as_str()
            );
            assert_eq!(Seal::from(SealDto::from(seal)), seal);
            assert_eq!(
                id(serde_json::to_value(SealFamilyDto::from(seal.family())).unwrap()),
                seal.family().as_str()
            );
        }
        for source in StrokeSource::ALL {
            assert_eq!(
                id(serde_json::to_value(StrokeSourceDto::from(source)).unwrap()),
                source.as_str()
            );
        }
        for level in domain::progress::LEVELS {
            let dto = LevelNameDto::from(level.name);
            assert_eq!(id(serde_json::to_value(dto).unwrap()), level.name.as_str());
            assert_eq!(LevelName::from(dto), level.name);
        }
    }

    #[test]
    fn the_level_reports_how_far_it_is_to_the_next() {
        let flow = ProgressLevelDto::from(domain::progress::level_for(2_410));
        assert_eq!(
            flow,
            ProgressLevelDto {
                number: 4,
                name: LevelNameDto::Flow,
                total: 2_410,
                into_level: 410,
                span: Some(2_000),
                next_name: Some(LevelNameDto::Craft),
            }
        );
        let top = ProgressLevelDto::from(domain::progress::level_for(50_000));
        assert_eq!((top.span, top.next_name), (None, None));
    }
}
