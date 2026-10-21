use std::sync::Mutex;

use application::ports::{GoalEvent, GoalRepository, PortError, PortResult};
use domain::{ActivityId, Goal, GoalEventKind, GoalKind, GoalScope, Period, UtcMs};
use rusqlite::{Connection, Row, params};

use crate::db::{lock, port_err};

/// Goals and their event log (migration 0003).
pub struct SqliteGoalRepository {
    conn: Mutex<Connection>,
}

impl SqliteGoalRepository {
    /// `conn` must come from [`crate::open`] / [`crate::open_in_memory`].
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

const COLUMNS: &str = "id, label, scope_kind, activity_id, app_id, period, kind, target_ms, active_days, archived, created_at";

fn goal_from_row(r: &Row<'_>) -> rusqlite::Result<PortResult<Goal>> {
    let id: i64 = r.get(0)?;
    let scope_kind: String = r.get(2)?;
    let activity_id: Option<i64> = r.get(3)?;
    let app_id: Option<String> = r.get(4)?;
    let period: String = r.get(5)?;
    let kind: String = r.get(6)?;
    let scope = match (scope_kind.as_str(), activity_id, app_id) {
        ("activity", Some(a), _) => Some(GoalScope::Activity(ActivityId(a))),
        ("app", _, Some(app)) => Some(GoalScope::App(app)),
        ("total", _, _) => Some(GoalScope::Total),
        _ => None,
    };
    let (period, kind) = (Period::parse(&period), GoalKind::parse(&kind));
    let active_days: i64 = r.get(8)?;
    let archived: i64 = r.get(9)?;
    Ok(match (scope, period, kind) {
        (Some(scope), Some(period), Some(kind)) => Ok(Goal {
            id,
            label: r.get(1)?,
            scope,
            period,
            kind,
            target_ms: r.get(7)?,
            active_days: u8::try_from(active_days).unwrap_or(0),
            archived: archived != 0,
            created_at: UtcMs(r.get(10)?),
        }),
        _ => Err(PortError(format!("malformed goal {id}"))),
    })
}

fn scope_columns(scope: &GoalScope) -> (&'static str, Option<i64>, Option<&str>) {
    match scope {
        GoalScope::Activity(id) => ("activity", Some(id.0), None),
        GoalScope::App(app) => ("app", None, Some(app.as_str())),
        GoalScope::Total => ("total", None, None),
    }
}

impl GoalRepository for SqliteGoalRepository {
    fn list(&self) -> PortResult<Vec<Goal>> {
        let conn = lock(&self.conn, "goal")?;
        let mut stmt = conn
            .prepare(&format!("SELECT {COLUMNS} FROM goals ORDER BY id"))
            .map_err(port_err)?;
        let rows = stmt
            .query_map([], goal_from_row)
            .map_err(port_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_err)?;
        rows.into_iter().collect()
    }

    fn save(&self, goal: &Goal) -> PortResult<Goal> {
        let conn = lock(&self.conn, "goal")?;
        let (scope_kind, activity_id, app_id) = scope_columns(&goal.scope);
        let id = if goal.id > 0 {
            let changed = conn
                .execute(
                    "UPDATE goals SET label = ?2, scope_kind = ?3, activity_id = ?4, app_id = ?5,
                       period = ?6, kind = ?7, target_ms = ?8, active_days = ?9, archived = ?10
                     WHERE id = ?1",
                    params![
                        goal.id,
                        goal.label,
                        scope_kind,
                        activity_id,
                        app_id,
                        goal.period.as_str(),
                        goal.kind.as_str(),
                        goal.target_ms,
                        goal.active_days,
                        goal.archived
                    ],
                )
                .map_err(port_err)?;
            if changed == 0 {
                return Err(PortError(format!("goal {} not found", goal.id)));
            }
            goal.id
        } else {
            conn.execute(
                "INSERT INTO goals(label, scope_kind, activity_id, app_id, period, kind,
                   target_ms, active_days, archived, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    goal.label,
                    scope_kind,
                    activity_id,
                    app_id,
                    goal.period.as_str(),
                    goal.kind.as_str(),
                    goal.target_ms,
                    goal.active_days,
                    goal.archived,
                    goal.created_at.0
                ],
            )
            .map_err(port_err)?;
            conn.last_insert_rowid()
        };
        conn.query_row(
            &format!("SELECT {COLUMNS} FROM goals WHERE id = ?1"),
            [id],
            goal_from_row,
        )
        .map_err(port_err)?
    }

    fn delete(&self, id: i64) -> PortResult<()> {
        let conn = lock(&self.conn, "goal")?;
        // Events go with the goal (ON DELETE CASCADE).
        conn.execute("DELETE FROM goals WHERE id = ?1", [id])
            .map(|_| ())
            .map_err(port_err)
    }

    fn record_event(&self, event: &GoalEvent) -> PortResult<bool> {
        let conn = lock(&self.conn, "goal")?;
        let inserted = conn
            .execute(
                "INSERT OR IGNORE INTO goal_events(goal_id, period_start, kind, at, notified, seen)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    event.goal_id,
                    event.period_start_day,
                    event.kind.as_str(),
                    event.at.0,
                    event.notified,
                    event.seen
                ],
            )
            .map_err(port_err)?;
        Ok(inserted > 0)
    }

    fn clear_events(&self, goal_id: i64, period_start_day: i64) -> PortResult<()> {
        let conn = lock(&self.conn, "goal")?;
        conn.execute(
            "DELETE FROM goal_events WHERE goal_id = ?1 AND period_start = ?2",
            [goal_id, period_start_day],
        )
        .map(|_| ())
        .map_err(port_err)
    }

    fn unseen_events(&self) -> PortResult<Vec<GoalEvent>> {
        let conn = lock(&self.conn, "goal")?;
        let mut stmt = conn
            .prepare(
                "SELECT goal_id, period_start, kind, at, notified, seen
                 FROM goal_events WHERE seen = 0 ORDER BY at, goal_id",
            )
            .map_err(port_err)?;
        let rows = stmt
            .query_map([], |r| {
                let kind: String = r.get(2)?;
                Ok((
                    GoalEventKind::parse(&kind),
                    GoalEvent {
                        goal_id: r.get(0)?,
                        period_start_day: r.get(1)?,
                        kind: GoalEventKind::Reached,
                        at: UtcMs(r.get(3)?),
                        notified: r.get::<_, i64>(4)? != 0,
                        seen: r.get::<_, i64>(5)? != 0,
                    },
                ))
            })
            .map_err(port_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_err)?;
        rows.into_iter()
            .map(|(kind, event)| {
                kind.map(|kind| GoalEvent { kind, ..event })
                    .ok_or_else(|| PortError("malformed goal event".into()))
            })
            .collect()
    }

    fn mark_seen(&self, goal_id: i64) -> PortResult<()> {
        let conn = lock(&self.conn, "goal")?;
        conn.execute(
            "UPDATE goal_events SET seen = 1 WHERE goal_id = ?1 AND seen = 0",
            [goal_id],
        )
        .map(|_| ())
        .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::open_in_memory;

    fn repo() -> SqliteGoalRepository {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO activities(id, name, color) VALUES (2, 'Work', '#111')",
            [],
        )
        .unwrap();
        SqliteGoalRepository::new(conn)
    }

    fn goal(scope: GoalScope) -> Goal {
        Goal {
            id: 0,
            label: "Deep work".into(),
            scope,
            period: Period::Daily,
            kind: GoalKind::Minimum,
            target_ms: 7_200_000,
            active_days: 0b001_1111,
            archived: false,
            created_at: UtcMs(1_000),
        }
    }

    fn event(kind: GoalEventKind, day: i64) -> GoalEvent {
        GoalEvent {
            goal_id: 1,
            period_start_day: day,
            kind,
            at: UtcMs(5),
            notified: false,
            seen: false,
        }
    }

    #[test]
    fn goals_round_trip_for_every_scope() {
        let r = repo();
        let a = r.save(&goal(GoalScope::Activity(ActivityId(2)))).unwrap();
        let b = r.save(&goal(GoalScope::App("com.mail".into()))).unwrap();
        let c = r.save(&goal(GoalScope::Total)).unwrap();
        assert_eq!((a.id, b.id, c.id), (1, 2, 3));
        let all = r.list().unwrap();
        assert_eq!(all, vec![a, b, c]);
        assert_eq!(all[0].created_at, UtcMs(1_000));
        assert_eq!(all[1].scope, GoalScope::App("com.mail".into()));
    }

    #[test]
    fn updating_changes_the_goal_but_not_its_creation_time() {
        let r = repo();
        let mut g = r.save(&goal(GoalScope::Total)).unwrap();
        g.label = "Less time".into();
        g.kind = GoalKind::Maximum;
        g.archived = true;
        g.created_at = UtcMs(99);
        let saved = r.save(&g).unwrap();
        assert_eq!(saved.label, "Less time");
        assert!(saved.archived && saved.kind == GoalKind::Maximum);
        assert_eq!(saved.created_at, UtcMs(1_000));
        let mut ghost = g;
        ghost.id = 42;
        assert!(r.save(&ghost).is_err());
    }

    #[test]
    fn events_are_stored_once_per_period_and_kind() {
        let r = repo();
        r.save(&goal(GoalScope::Total)).unwrap();
        assert!(r.record_event(&event(GoalEventKind::Reached, 10)).unwrap());
        assert!(!r.record_event(&event(GoalEventKind::Reached, 10)).unwrap());
        assert!(r.record_event(&event(GoalEventKind::Reached, 11)).unwrap());
        assert!(r.record_event(&event(GoalEventKind::Exceeded, 10)).unwrap());
        assert_eq!(r.unseen_events().unwrap().len(), 3);
        r.mark_seen(1).unwrap();
        assert!(r.unseen_events().unwrap().is_empty());
        r.clear_events(1, 10).unwrap();
        assert!(r.record_event(&event(GoalEventKind::Reached, 10)).unwrap());
    }

    #[test]
    fn deleting_a_goal_removes_its_events() {
        let r = repo();
        r.save(&goal(GoalScope::Total)).unwrap();
        r.record_event(&event(GoalEventKind::Reached, 10)).unwrap();
        r.delete(1).unwrap();
        assert!(r.list().unwrap().is_empty());
        assert!(r.unseen_events().unwrap().is_empty());
    }
}
