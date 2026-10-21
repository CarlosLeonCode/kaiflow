use std::sync::Mutex;

use application::ports::{AiReviewRepository, PortError, PortResult, ReviewStatus, StoredReview};
use domain::UtcMs;
use rusqlite::{Connection, Row, params};

use crate::db::{lock, port_err};

/// AI weekly reviews (migration 0005).
pub struct SqliteAiReviewRepository {
    conn: Mutex<Connection>,
}

impl SqliteAiReviewRepository {
    /// `conn` must come from [`crate::open`] / [`crate::open_in_memory`].
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

const COLUMNS: &str = "id, period_start, period_end, period_label, provider, model,
     included_titles, request_json, response_json, status, created_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<PortResult<StoredReview>> {
    let status: String = r.get(9)?;
    let review = StoredReview {
        id: r.get(0)?,
        period_start: UtcMs(r.get(1)?),
        period_end: UtcMs(r.get(2)?),
        period_label: r.get(3)?,
        provider: r.get(4)?,
        model: r.get(5)?,
        included_titles: r.get::<_, i64>(6)? != 0,
        request_json: r.get(7)?,
        response_json: r.get(8)?,
        status: ReviewStatus::Ok,
        created_at: UtcMs(r.get(10)?),
    };
    Ok(ReviewStatus::parse(&status)
        .map(|status| StoredReview { status, ..review })
        .ok_or_else(|| PortError(format!("unknown review status `{status}`"))))
}

fn collect(
    rows: rusqlite::MappedRows<
        '_,
        impl FnMut(&Row<'_>) -> rusqlite::Result<PortResult<StoredReview>>,
    >,
) -> PortResult<Vec<StoredReview>> {
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(port_err)??);
    }
    Ok(out)
}

impl AiReviewRepository for SqliteAiReviewRepository {
    fn insert(&self, review: &StoredReview) -> PortResult<StoredReview> {
        let conn = lock(&self.conn, "ai reviews")?;
        conn.execute(
            "INSERT INTO ai_reviews(period_start, period_end, period_label, provider, model,
               included_titles, request_json, response_json, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                review.period_start.0,
                review.period_end.0,
                review.period_label,
                review.provider,
                review.model,
                review.included_titles,
                review.request_json,
                review.response_json,
                review.status.as_str(),
                review.created_at.0
            ],
        )
        .map_err(port_err)?;
        Ok(StoredReview {
            id: conn.last_insert_rowid(),
            ..review.clone()
        })
    }

    fn list(&self, limit: u32) -> PortResult<Vec<StoredReview>> {
        let conn = lock(&self.conn, "ai reviews")?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM ai_reviews ORDER BY created_at DESC, id DESC LIMIT ?1"
            ))
            .map_err(port_err)?;
        let rows = stmt.query_map([limit], from_row).map_err(port_err)?;
        collect(rows)
    }

    fn for_period(&self, period_start: UtcMs) -> PortResult<Vec<StoredReview>> {
        let conn = lock(&self.conn, "ai reviews")?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM ai_reviews WHERE period_start = ?1
                 ORDER BY created_at DESC, id DESC"
            ))
            .map_err(port_err)?;
        let rows = stmt
            .query_map([period_start.0], from_row)
            .map_err(port_err)?;
        collect(rows)
    }

    fn delete(&self, id: i64) -> PortResult<bool> {
        let conn = lock(&self.conn, "ai reviews")?;
        let n = conn
            .execute("DELETE FROM ai_reviews WHERE id = ?1", [id])
            .map_err(port_err)?;
        Ok(n > 0)
    }

    fn delete_all(&self) -> PortResult<usize> {
        let conn = lock(&self.conn, "ai reviews")?;
        conn.execute("DELETE FROM ai_reviews", []).map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::open_in_memory;

    fn review(start: i64, created: i64, status: ReviewStatus) -> StoredReview {
        StoredReview {
            id: 0,
            period_start: UtcMs(start),
            period_end: UtcMs(start + 7),
            period_label: "2026-10-12 to 2026-10-18".into(),
            provider: "ollama".into(),
            model: "llama".into(),
            included_titles: true,
            request_json: "{\"totals\":{}}".into(),
            response_json: "{\"summary\":\"ok\"}".into(),
            status,
            created_at: UtcMs(created),
        }
    }

    #[test]
    fn insert_list_filter_and_delete() {
        let repo = SqliteAiReviewRepository::new(open_in_memory().unwrap());
        let a = repo.insert(&review(100, 1, ReviewStatus::Ok)).unwrap();
        let b = repo
            .insert(&review(100, 2, ReviewStatus::TextFallback))
            .unwrap();
        let c = repo.insert(&review(200, 3, ReviewStatus::Ok)).unwrap();
        assert!(a.id > 0 && b.id > a.id && c.id > b.id);

        let all = repo.list(10).unwrap();
        assert_eq!(
            all.iter().map(|r| r.id).collect::<Vec<_>>(),
            [c.id, b.id, a.id],
            "newest first"
        );
        assert_eq!(all[1].status, ReviewStatus::TextFallback);
        assert!(all[0].included_titles);
        assert_eq!(repo.list(1).unwrap().len(), 1);

        let week = repo.for_period(UtcMs(100)).unwrap();
        assert_eq!(week.iter().map(|r| r.id).collect::<Vec<_>>(), [b.id, a.id]);

        assert!(repo.delete(a.id).unwrap());
        assert!(!repo.delete(a.id).unwrap(), "already gone");
        assert_eq!(repo.list(10).unwrap().len(), 2);
        assert_eq!(repo.delete_all().unwrap(), 2);
        assert!(repo.list(10).unwrap().is_empty());
    }

    #[test]
    fn the_schema_rejects_unknown_providers_statuses_and_inverted_periods() {
        let repo = SqliteAiReviewRepository::new(open_in_memory().unwrap());
        let mut bad = review(100, 1, ReviewStatus::Ok);
        bad.provider = "nope".into();
        assert!(repo.insert(&bad).is_err());
        let mut inverted = review(100, 1, ReviewStatus::Ok);
        inverted.period_end = UtcMs(50);
        assert!(repo.insert(&inverted).is_err());
        let mut nameless = review(100, 1, ReviewStatus::Ok);
        nameless.model = String::new();
        assert!(repo.insert(&nameless).is_err());
    }
}
