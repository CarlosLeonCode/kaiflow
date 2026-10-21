use std::sync::Mutex;

use application::ports::{ActivityRepository, PortError, PortResult};
use domain::{Activity, ActivityId, ActivityRule, Productivity, RuleKind, UNASSIGNED};
use rusqlite::{Connection, params};

use crate::db::{lock, port_err};

/// Activities and their rules (R9.1). Rule patterns are validated by `domain` (R9.4).
pub struct SqliteActivityRepository {
    conn: Mutex<Connection>,
}

impl SqliteActivityRepository {
    /// `conn` must come from [`crate::open`] / [`crate::open_in_memory`].
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

fn rule_from_row(
    id: i64,
    activity: i64,
    kind: &str,
    app_id: Option<String>,
    pattern: Option<String>,
    priority: i32,
) -> PortResult<ActivityRule> {
    let activity_id = ActivityId(activity);
    match (kind, app_id, pattern) {
        ("app", Some(bundle), _) => Ok(ActivityRule {
            id,
            activity_id,
            kind: RuleKind::App(bundle),
            priority,
        }),
        ("title", app_id, Some(pattern)) => {
            ActivityRule::title_pattern(id, activity_id, &pattern, app_id, priority)
                .map_err(|e| PortError(format!("invalid pattern '{}': {}", e.pattern, e.reason)))
        }
        _ => Err(PortError(format!("malformed activity rule {id}"))),
    }
}

impl ActivityRepository for SqliteActivityRepository {
    fn list(&self) -> PortResult<Vec<Activity>> {
        let conn = lock(&self.conn, "activity")?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, color, sort_order, productivity, preset_key
                 FROM activities ORDER BY sort_order, id",
            )
            .map_err(port_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Activity {
                    id: ActivityId(r.get(0)?),
                    name: r.get(1)?,
                    color: r.get(2)?,
                    sort_order: r.get(3)?,
                    productivity: Productivity::parse(&r.get::<_, String>(4)?).unwrap_or_default(),
                    preset_key: r.get(5)?,
                })
            })
            .map_err(port_err)?;
        rows.map(|r| r.map_err(port_err)).collect()
    }

    fn create(&self, name: &str, color: &str, productivity: Productivity) -> PortResult<Activity> {
        let conn = lock(&self.conn, "activity")?;
        conn.execute(
            "INSERT INTO activities(name, color, sort_order, productivity)
             VALUES (?1, ?2, (SELECT coalesce(max(sort_order), 0) + 1 FROM activities), ?3)",
            params![name, color, productivity.as_str()],
        )
        .map_err(port_err)?;
        let id = conn.last_insert_rowid();
        let sort_order = conn
            .query_row(
                "SELECT sort_order FROM activities WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .map_err(port_err)?;
        Ok(Activity {
            id: ActivityId(id),
            name: name.into(),
            color: color.into(),
            sort_order,
            productivity,
            preset_key: None,
        })
    }

    fn update(&self, activity: &Activity) -> PortResult<()> {
        let conn = lock(&self.conn, "activity")?;
        let changed = conn
            .execute(
                "UPDATE activities SET name = ?1, color = ?2, sort_order = ?3, productivity = ?4
                 WHERE id = ?5",
                params![
                    activity.name,
                    activity.color,
                    activity.sort_order,
                    activity.productivity.as_str(),
                    activity.id.0
                ],
            )
            .map_err(port_err)?;
        if changed == 0 {
            return Err(PortError(format!("activity {} not found", activity.id.0)));
        }
        Ok(())
    }

    fn delete(&self, id: ActivityId) -> PortResult<()> {
        if id == UNASSIGNED {
            return Err(PortError("the system activity cannot be deleted".into()));
        }
        let mut conn = lock(&self.conn, "activity")?;
        let tx = conn.transaction().map_err(port_err)?;
        // `ON DELETE SET NULL` would leave activity-only idle segments with neither app nor
        // activity and violate the CHECK, so every segment moves to the system activity first.
        tx.execute(
            "UPDATE segments SET activity_id = ?1 WHERE activity_id = ?2",
            [UNASSIGNED.0, id.0],
        )
        .map_err(port_err)?;
        tx.execute("DELETE FROM activities WHERE id = ?1", [id.0])
            .map_err(port_err)?;
        tx.commit().map_err(port_err)
    }

    fn list_rules(&self) -> PortResult<Vec<ActivityRule>> {
        let conn = lock(&self.conn, "activity")?;
        let mut stmt = conn
            .prepare(
                "SELECT id, activity_id, kind, app_id, pattern, priority
                 FROM activity_rules ORDER BY id",
            )
            .map_err(port_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i32>(5)?,
                ))
            })
            .map_err(port_err)?;
        let mut rules = Vec::new();
        for row in rows {
            let (id, activity, kind, app_id, pattern, priority) = row.map_err(port_err)?;
            rules.push(rule_from_row(
                id, activity, &kind, app_id, pattern, priority,
            )?);
        }
        Ok(rules)
    }

    fn save_rule(&self, rule: &ActivityRule) -> PortResult<i64> {
        let conn = lock(&self.conn, "activity")?;
        let (kind, app_id, pattern) = match &rule.kind {
            RuleKind::App(bundle) => ("app", Some(bundle.as_str()), None),
            RuleKind::TitlePattern { regex, app_id } => {
                ("title", app_id.as_deref(), Some(regex.as_str()))
            }
        };
        if rule.id <= 0 {
            conn.execute(
                "INSERT INTO activity_rules(activity_id, kind, app_id, pattern, priority)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![rule.activity_id.0, kind, app_id, pattern, rule.priority],
            )
            .map_err(port_err)?;
            return Ok(conn.last_insert_rowid());
        }
        let changed = conn
            .execute(
                "UPDATE activity_rules
                 SET activity_id = ?1, kind = ?2, app_id = ?3, pattern = ?4, priority = ?5
                 WHERE id = ?6",
                params![
                    rule.activity_id.0,
                    kind,
                    app_id,
                    pattern,
                    rule.priority,
                    rule.id
                ],
            )
            .map_err(port_err)?;
        if changed == 0 {
            return Err(PortError(format!("rule {} not found", rule.id)));
        }
        Ok(rule.id)
    }

    fn delete_rule(&self, id: i64) -> PortResult<()> {
        let conn = lock(&self.conn, "activity")?;
        conn.execute("DELETE FROM activity_rules WHERE id = ?1", [id])
            .map(|_| ())
            .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use domain::{Segment, SegmentSource, UtcMs, classify};

    fn repo() -> SqliteActivityRepository {
        SqliteActivityRepository::new(open_in_memory().unwrap())
    }

    fn exec(repo: &SqliteActivityRepository, sql: &str, p: impl rusqlite::Params) {
        repo.conn.lock().unwrap().execute(sql, p).unwrap();
    }

    fn activity_of(repo: &SqliteActivityRepository, segment: i64) -> Option<i64> {
        repo.conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT activity_id FROM segments WHERE id = ?1",
                [segment],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn system_activity_exists_and_new_ones_append() {
        let r = repo();
        let work = r.create("Work", "#111111", Productivity::Neutral).unwrap();
        let play = r.create("Play", "#222222", Productivity::Neutral).unwrap();
        assert_eq!((work.sort_order, play.sort_order), (1, 2));
        let names: Vec<_> = r.list().unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["Unassigned", "Work", "Play"]);
        assert!(
            r.create("Work", "#333333", Productivity::Neutral).is_err(),
            "names are unique"
        );
    }

    #[test]
    fn productivity_is_stored_and_updatable() {
        let r = repo();
        let mut play = r
            .create("Play", "#222222", Productivity::Distracting)
            .unwrap();
        assert_eq!(play.productivity, Productivity::Distracting);
        play.productivity = Productivity::Productive;
        r.update(&play).unwrap();
        let listed = r.list().unwrap();
        assert_eq!(listed[0].productivity, Productivity::Neutral, "system row");
        assert_eq!(listed[1].productivity, Productivity::Productive);
        assert_eq!(listed[1].preset_key, None);
    }

    #[test]
    fn update_changes_fields_and_unknown_id_fails() {
        let r = repo();
        let mut c = r.create("Work", "#111111", Productivity::Neutral).unwrap();
        c.name = "Deep work".into();
        c.color = "#abcdef".into();
        r.update(&c).unwrap();
        assert!(r.list().unwrap().contains(&c));
        c.id = ActivityId(999);
        assert!(r.update(&c).is_err());
    }

    #[test]
    fn delete_reassigns_all_its_segments_including_activity_only_idle_ones() {
        let r = repo();
        let work = r.create("Work", "#111111", Productivity::Neutral).unwrap();
        let keep = r.create("Keep", "#222222", Productivity::Neutral).unwrap();
        // 1: activity-only idle segment (NULL app), 2: tracked with manual activity,
        // 3: segment of another activity.
        exec(
            &r,
            "INSERT INTO segments(id, started_at, ended_at, heartbeat_at, end_reason, source, activity_id)
             VALUES (1, 0, 10, 10, 'idle', 'idle_assigned', ?1)",
            [work.id.0],
        );
        exec(
            &r,
            "INSERT INTO segments(id, started_at, ended_at, heartbeat_at, app_id, app_name, source, activity_id)
             VALUES (2, 10, 20, 20, 'a', 'A', 'tracked', ?1)",
            [work.id.0],
        );
        exec(
            &r,
            "INSERT INTO segments(id, started_at, ended_at, heartbeat_at, end_reason, source, activity_id)
             VALUES (3, 20, 30, 30, 'idle', 'idle_assigned', ?1)",
            [keep.id.0],
        );
        r.delete(work.id).unwrap();
        assert_eq!(activity_of(&r, 1), Some(1));
        assert_eq!(activity_of(&r, 2), Some(1));
        assert_eq!(activity_of(&r, 3), Some(keep.id.0));
        assert!(r.list().unwrap().iter().all(|c| c.id != work.id));
    }

    #[test]
    fn delete_cascades_rules_and_is_idempotent_for_unknown_ids() {
        let r = repo();
        let work = r.create("Work", "#111111", Productivity::Neutral).unwrap();
        r.save_rule(&ActivityRule {
            id: 0,
            activity_id: work.id,
            kind: RuleKind::App("slack".into()),
            priority: 0,
        })
        .unwrap();
        r.delete(work.id).unwrap();
        assert!(r.list_rules().unwrap().is_empty());
        r.delete(ActivityId(999)).unwrap();
    }

    #[test]
    fn system_activity_cannot_be_deleted_even_around_the_port() {
        let r = repo();
        assert!(r.delete(UNASSIGNED).is_err());
        let direct = r
            .conn
            .lock()
            .unwrap()
            .execute("DELETE FROM activities WHERE id = 1", []);
        assert!(direct.is_err(), "the trigger blocks raw deletes");
        assert_eq!(r.list().unwrap().len(), 1);
    }

    #[test]
    fn rules_round_trip_and_drive_domain_classification() {
        let r = repo();
        let work = r.create("Work", "#111111", Productivity::Neutral).unwrap();
        let design = r
            .create("Design", "#222222", Productivity::Neutral)
            .unwrap();
        let app_id = r
            .save_rule(&ActivityRule {
                id: 0,
                activity_id: work.id,
                kind: RuleKind::App("chrome".into()),
                priority: 5,
            })
            .unwrap();
        let title_id = r
            .save_rule(
                &ActivityRule::title_pattern(0, design.id, "Figma", Some("chrome".into()), 1)
                    .unwrap(),
            )
            .unwrap();
        assert_ne!(app_id, title_id);

        let rules = r.list_rules().unwrap();
        assert_eq!(rules.len(), 2);
        assert_eq!((rules[0].id, rules[0].priority), (app_id, 5));
        let seg = |title: &str| Segment {
            id: domain::SegmentId(1),
            started_at: UtcMs(0),
            ended_at: Some(UtcMs(1)),
            heartbeat_at: UtcMs(1),
            app_id: Some("chrome".into()),
            app_name: Some("Chrome".into()),
            window_title: Some(title.into()),
            end_reason: None,
            source: SegmentSource::Tracked,
            activity_id: None,
        };
        assert_eq!(classify(&seg("Figma - file"), &rules), design.id);
        assert_eq!(classify(&seg("inbox"), &rules), work.id);
    }

    #[test]
    fn save_rule_updates_in_place_and_rejects_unknown_ids_and_activities() {
        let r = repo();
        let work = r.create("Work", "#111111", Productivity::Neutral).unwrap();
        let mut rule = ActivityRule {
            id: 0,
            activity_id: work.id,
            kind: RuleKind::App("slack".into()),
            priority: 0,
        };
        rule.id = r.save_rule(&rule).unwrap();
        rule.priority = 9;
        rule.kind = RuleKind::App("teams".into());
        assert_eq!(r.save_rule(&rule).unwrap(), rule.id);
        let stored = r.list_rules().unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].priority, 9);

        let ghost = ActivityRule {
            id: 777,
            ..rule.clone()
        };
        assert!(r.save_rule(&ghost).is_err());
        let orphan = ActivityRule {
            id: 0,
            activity_id: ActivityId(999),
            ..rule
        };
        assert!(r.save_rule(&orphan).is_err(), "foreign key enforced");

        r.delete_rule(stored[0].id).unwrap();
        r.delete_rule(stored[0].id).unwrap();
        assert!(r.list_rules().unwrap().is_empty());
    }

    #[test]
    fn invalid_title_pattern_never_reaches_the_store() {
        // The domain constructor is the only way to build a title rule (R9.4).
        let err = ActivityRule::title_pattern(0, ActivityId(1), "(unclosed", None, 0).unwrap_err();
        assert_eq!(err.pattern, "(unclosed");
        let r = repo();
        assert!(r.list_rules().unwrap().is_empty());
    }

    #[test]
    fn a_corrupt_stored_pattern_is_reported_not_panicked() {
        let r = repo();
        exec(
            &r,
            "INSERT INTO activity_rules(activity_id, kind, pattern) VALUES (1, 'title', '(bad')",
            [],
        );
        assert!(r.list_rules().unwrap_err().0.contains("invalid pattern"));
    }
}
