use std::sync::Mutex;

use application::ports::{EarnedSeal, PortError, PortResult, ProgressRepository, StrokeEntry};
use domain::progress::grant;
use domain::{DAILY_CAP, Seal, StrokeAward, StrokeSource, UtcMs};
use rusqlite::{Connection, TransactionBehavior, params};

use crate::db::{lock, port_err};

/// The strokes ledger and the seals earned (migration 0007).
pub struct SqliteProgressRepository {
    conn: Mutex<Connection>,
}

impl SqliteProgressRepository {
    /// `conn` must come from [`crate::open`] / [`crate::open_in_memory`].
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

fn day_sum(conn: &Connection, day: i64) -> PortResult<u32> {
    let sum: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(strokes), 0) FROM stroke_awards WHERE day = ?1",
            [day],
            |r| r.get(0),
        )
        .map_err(port_err)?;
    Ok(u32::try_from(sum).unwrap_or(u32::MAX))
}

fn days(conn: &Connection, min_sum: u32) -> PortResult<Vec<i64>> {
    let mut stmt = conn
        .prepare(
            "SELECT day FROM stroke_awards GROUP BY day HAVING SUM(strokes) >= ?1 ORDER BY day",
        )
        .map_err(port_err)?;
    stmt.query_map([min_sum], |r| r.get(0))
        .map_err(port_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(port_err)
}

impl ProgressRepository for SqliteProgressRepository {
    fn record(&self, award: StrokeAward, day: i64, at: UtcMs) -> PortResult<Option<u32>> {
        let mut conn = lock(&self.conn, "progress")?;
        // IMMEDIATE takes the write lock up front, so the day total cannot change between the
        // read and the insert.
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(port_err)?;
        let key = award.key();
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM stroke_awards WHERE award_key = ?1)",
                [&key],
                |r| r.get(0),
            )
            .map_err(port_err)?;
        if exists {
            return Ok(None);
        }
        let granted = grant(day_sum(&tx, day)?, award.strokes());
        tx.execute(
            "INSERT INTO stroke_awards(award_key, day, source, strokes, earned_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![key, day, award.source().as_str(), granted, at.0],
        )
        .map_err(port_err)?;
        tx.commit().map_err(port_err)?;
        Ok(Some(granted))
    }

    fn day_total(&self, day: i64) -> PortResult<u32> {
        let conn = lock(&self.conn, "progress")?;
        day_sum(&conn, day)
    }

    fn day_entries(&self, day: i64) -> PortResult<Vec<StrokeEntry>> {
        let conn = lock(&self.conn, "progress")?;
        let mut stmt = conn
            .prepare(
                "SELECT award_key, day, source, strokes, earned_at
                 FROM stroke_awards WHERE day = ?1 ORDER BY earned_at, id",
            )
            .map_err(port_err)?;
        let rows = stmt
            .query_map([day], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, u32>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(port_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_err)?;
        rows.into_iter()
            .map(|(key, day, source, strokes, earned_at)| {
                let source = StrokeSource::parse(&source)
                    .ok_or_else(|| PortError(format!("unknown stroke source `{source}`")))?;
                Ok(StrokeEntry {
                    key,
                    day,
                    source,
                    strokes,
                    earned_at: UtcMs(earned_at),
                })
            })
            .collect()
    }

    fn total(&self) -> PortResult<u64> {
        let conn = lock(&self.conn, "progress")?;
        let sum: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(strokes), 0) FROM stroke_awards",
                [],
                |r| r.get(0),
            )
            .map_err(port_err)?;
        Ok(u64::try_from(sum).unwrap_or(0))
    }

    fn stroke_days(&self) -> PortResult<Vec<i64>> {
        let conn = lock(&self.conn, "progress")?;
        days(&conn, 1)
    }

    fn full_days(&self) -> PortResult<Vec<i64>> {
        let conn = lock(&self.conn, "progress")?;
        days(&conn, DAILY_CAP)
    }

    fn source_count(&self, source: StrokeSource) -> PortResult<u32> {
        let conn = lock(&self.conn, "progress")?;
        conn.query_row(
            "SELECT COUNT(*) FROM stroke_awards WHERE source = ?1",
            [source.as_str()],
            |r| r.get(0),
        )
        .map_err(port_err)
    }

    fn seals(&self) -> PortResult<Vec<EarnedSeal>> {
        let conn = lock(&self.conn, "progress")?;
        let mut stmt = conn
            .prepare("SELECT seal, earned_at, seen FROM seals ORDER BY earned_at, seal")
            .map_err(port_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(port_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_err)?;
        rows.into_iter()
            .map(|(name, earned_at, seen)| {
                let seal = Seal::parse(&name)
                    .ok_or_else(|| PortError(format!("unknown seal `{name}`")))?;
                Ok(EarnedSeal {
                    seal,
                    earned_at: UtcMs(earned_at),
                    seen: seen != 0,
                })
            })
            .collect()
    }

    fn add_seal(&self, seal: Seal, at: UtcMs) -> PortResult<bool> {
        let conn = lock(&self.conn, "progress")?;
        let inserted = conn
            .execute(
                "INSERT OR IGNORE INTO seals(seal, earned_at) VALUES (?1, ?2)",
                params![seal.as_str(), at.0],
            )
            .map_err(port_err)?;
        Ok(inserted > 0)
    }

    fn mark_seal_seen(&self, seal: Seal) -> PortResult<()> {
        let conn = lock(&self.conn, "progress")?;
        conn.execute("UPDATE seals SET seen = 1 WHERE seal = ?1", [seal.as_str()])
            .map(|_| ())
            .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::open_in_memory;

    fn repo() -> SqliteProgressRepository {
        SqliteProgressRepository::new(open_in_memory().unwrap())
    }

    fn focus(session: i64) -> StrokeAward {
        StrokeAward::FocusCompleted {
            started: UtcMs(session),
        }
    }

    fn goal(goal: i64, day: i64) -> StrokeAward {
        StrokeAward::GoalMet { goal, day }
    }

    #[test]
    fn recording_an_award_twice_grants_nothing_the_second_time() {
        let r = repo();
        assert_eq!(r.record(focus(1), 10, UtcMs(5)).unwrap(), Some(10));
        assert_eq!(r.record(focus(1), 10, UtcMs(6)).unwrap(), None);
        assert_eq!(r.record(focus(1), 11, UtcMs(7)).unwrap(), None, "any day");
        assert_eq!(r.day_total(10).unwrap(), 10);
        assert_eq!(r.day_entries(10).unwrap().len(), 1);
    }

    #[test]
    fn the_daily_cap_is_clamped_across_awards_and_full_days_still_log() {
        let r = repo();
        // 6 goals of 15 = 90, then a focus block worth 10 only gets 10, then 0.
        for g in 1..=6 {
            assert_eq!(r.record(goal(g, 10), 10, UtcMs(g)).unwrap(), Some(15));
        }
        assert_eq!(r.record(focus(1), 10, UtcMs(20)).unwrap(), Some(10));
        assert_eq!(r.day_total(10).unwrap(), DAILY_CAP);
        assert_eq!(r.record(focus(2), 10, UtcMs(21)).unwrap(), Some(0));
        assert_eq!(r.record(goal(7, 10), 10, UtcMs(22)).unwrap(), Some(0));
        assert_eq!(r.day_total(10).unwrap(), DAILY_CAP);
        assert_eq!(
            r.source_count(StrokeSource::FocusCompleted).unwrap(),
            2,
            "the 0-stroke block still counts"
        );
        assert_eq!(r.source_count(StrokeSource::GoalMet).unwrap(), 7);
        assert_eq!(r.source_count(StrokeSource::BreakTaken).unwrap(), 0);
        // Another day has its own cap.
        assert_eq!(r.record(goal(1, 11), 11, UtcMs(30)).unwrap(), Some(15));
    }

    #[test]
    fn day_entries_are_oldest_first_with_their_source() {
        let r = repo();
        r.record(StrokeAward::BreakTaken { started: UtcMs(2) }, 10, UtcMs(50))
            .unwrap();
        r.record(focus(1), 10, UtcMs(40)).unwrap();
        r.record(focus(3), 11, UtcMs(60)).unwrap();
        let entries = r.day_entries(10).unwrap();
        assert_eq!(
            entries,
            vec![
                StrokeEntry {
                    key: "focus_completed:1".into(),
                    day: 10,
                    source: StrokeSource::FocusCompleted,
                    strokes: 10,
                    earned_at: UtcMs(40),
                },
                StrokeEntry {
                    key: "break_taken:2".into(),
                    day: 10,
                    source: StrokeSource::BreakTaken,
                    strokes: 3,
                    earned_at: UtcMs(50),
                },
            ]
        );
        assert!(r.day_entries(12).unwrap().is_empty());
    }

    #[test]
    fn an_unknown_source_is_reported() {
        let r = repo();
        r.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO stroke_awards(award_key, day, source, strokes, earned_at)
                 VALUES ('x', 10, 'mystery', 1, 1)",
                [],
            )
            .unwrap();
        assert!(r.day_entries(10).is_err());
    }

    #[test]
    fn totals_and_day_lists_follow_the_sums() {
        let r = repo();
        assert_eq!(r.total().unwrap(), 0);
        assert!(r.stroke_days().unwrap().is_empty());
        // Day 12 full, day 10 partial, day 11 only a 0-stroke row.
        for g in 1..=7 {
            r.record(goal(g, 12), 12, UtcMs(g)).unwrap();
        }
        r.record(focus(1), 10, UtcMs(1)).unwrap();
        r.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO stroke_awards(award_key, day, source, strokes, earned_at)
                 VALUES ('focus_completed:99', 11, 'focus_completed', 0, 1)",
                [],
            )
            .unwrap();
        assert_eq!(r.total().unwrap(), 110);
        assert_eq!(r.stroke_days().unwrap(), vec![10, 12]);
        assert_eq!(r.full_days().unwrap(), vec![12]);
    }

    #[test]
    fn seals_are_earned_once_and_marked_seen() {
        let r = repo();
        assert!(r.add_seal(Seal::FirstFocus, UtcMs(5)).unwrap());
        assert!(!r.add_seal(Seal::FirstFocus, UtcMs(9)).unwrap());
        assert!(r.add_seal(Seal::SevenDays, UtcMs(7)).unwrap());
        r.mark_seal_seen(Seal::FirstFocus).unwrap();
        r.mark_seal_seen(Seal::PerfectWeek).unwrap();
        assert_eq!(
            r.seals().unwrap(),
            vec![
                EarnedSeal {
                    seal: Seal::FirstFocus,
                    earned_at: UtcMs(5),
                    seen: true,
                },
                EarnedSeal {
                    seal: Seal::SevenDays,
                    earned_at: UtcMs(7),
                    seen: false,
                },
            ]
        );
    }
}
