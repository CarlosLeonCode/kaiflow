//! CSV export of a range (R8.2, R8.4). Written by hand: RFC 4180 quoting plus
//! neutralization of spreadsheet formulas.

use domain::{EndReason, UtcMs};

use crate::queries::TimelineItem;

/// CSV label for time assigned to an activity without an app.
const MANUAL_ASSIGNMENT_LABEL: &str = "Assigned manually";

pub const HEADER: [&str; 7] = [
    "start",
    "end",
    "duration_ms",
    "app",
    "title",
    "activity",
    "reason",
];

/// Renders the timeline as CSV (CRLF line endings, header always present). Times are
/// ISO 8601 UTC; the reason is empty for spans that were clipped or are still open.
pub fn render_csv(items: &[TimelineItem]) -> String {
    let mut out = String::new();
    push_row(&mut out, HEADER.iter().map(|h| (*h).to_owned()));
    for item in items {
        let app = item.app_name.as_deref().unwrap_or(MANUAL_ASSIGNMENT_LABEL);
        push_row(
            &mut out,
            [
                iso_utc(item.start),
                iso_utc(item.end),
                item.end.since(item.start).to_string(),
                neutralize(app),
                neutralize(item.window_title.as_deref().unwrap_or("")),
                neutralize(&item.activity_name),
                item.end_reason.map(reason_label).unwrap_or("").to_owned(),
            ]
            .into_iter(),
        );
    }
    out
}

fn push_row(out: &mut String, cells: impl Iterator<Item = String>) {
    for (i, cell) in cells.enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&quote(&cell));
    }
    out.push_str("\r\n");
}

/// Prefixes `'` to text a spreadsheet would read as a formula (R8.4).
pub fn neutralize(cell: &str) -> String {
    if cell.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{cell}")
    } else {
        cell.to_owned()
    }
}

/// RFC 4180: quote when the cell holds a comma, quote or line break; double inner quotes.
pub fn quote(cell: &str) -> String {
    if cell.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", cell.replace('"', "\"\""))
    } else {
        cell.to_owned()
    }
}

fn reason_label(reason: EndReason) -> &'static str {
    match reason {
        EndReason::FocusChange => "focus_change",
        EndReason::Idle => "idle",
        EndReason::Sleep => "sleep",
        EndReason::Lock => "lock",
        EndReason::Pause => "pause",
        EndReason::Stop => "stop",
        EndReason::Shutdown => "shutdown",
        EndReason::Recovered => "recovered",
    }
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` without a date library (days-to-civil algorithm).
fn iso_utc(t: UtcMs) -> String {
    let ms = t.0.rem_euclid(1000);
    let secs = t.0.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{ms:03}Z",
        tod / 3_600,
        tod % 3_600 / 60,
        tod % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{ActivityId, SegmentId, SegmentSource};

    fn item(app: Option<&str>, title: Option<&str>) -> TimelineItem {
        TimelineItem {
            segment_id: SegmentId(1),
            start: UtcMs(0),
            end: UtcMs(90_500),
            app_id: app.map(Into::into),
            app_name: app.map(Into::into),
            window_title: title.map(Into::into),
            activity_id: ActivityId(2),
            activity_name: "Work".into(),
            activity_color: "#fff".into(),
            source: SegmentSource::Tracked,
            end_reason: Some(EndReason::FocusChange),
            open: false,
        }
    }

    #[test]
    fn empty_range_is_header_only() {
        assert_eq!(
            render_csv(&[]),
            "start,end,duration_ms,app,title,activity,reason\r\n"
        );
    }

    #[test]
    fn row_has_all_fields_in_order() {
        let csv = render_csv(&[item(Some("Code"), Some("main.rs"))]);
        let row = csv.lines().nth(1).unwrap();
        assert_eq!(
            row,
            "1970-01-01T00:00:00.000Z,1970-01-01T00:01:30.500Z,90500,Code,main.rs,Work,focus_change"
        );
    }

    #[test]
    fn quotes_commas_quotes_and_newlines() {
        let csv = render_csv(&[item(Some("A"), Some("say \"hi\", ok\nline2"))]);
        assert!(csv.contains("\"say \"\"hi\"\", ok\nline2\""));
        assert_eq!(quote("plain"), "plain");
    }

    #[test]
    fn formula_prefixes_are_neutralized() {
        for bad in ["=CMD()", "+1", "-1", "@SUM(A1)", "\tx", "\rx"] {
            assert!(neutralize(bad).starts_with('\''), "{bad:?}");
        }
        assert_eq!(neutralize("safe=1"), "safe=1");
        let csv = render_csv(&[item(Some("A"), Some("=CMD()"))]);
        assert!(csv.contains(",'=CMD(),"));
    }

    #[test]
    fn control_prefix_that_needs_quoting_is_both_prefixed_and_quoted() {
        let csv = render_csv(&[item(Some("A"), Some("\rx"))]);
        assert!(csv.contains("\"'\rx\""));
    }

    #[test]
    fn manual_assignment_and_missing_title_and_clipped_reason() {
        let mut i = item(None, None);
        i.end_reason = None;
        let csv = render_csv(&[i]);
        assert!(
            csv.lines()
                .nth(1)
                .unwrap()
                .ends_with(",90500,Assigned manually,,Work,")
        );
    }

    #[test]
    fn iso_dates_handle_leap_day_and_pre_epoch() {
        // 2024-02-29T12:34:56.789Z
        assert_eq!(
            iso_utc(UtcMs(1_709_210_096_789)),
            "2024-02-29T12:34:56.789Z"
        );
        assert_eq!(iso_utc(UtcMs(-1)), "1969-12-31T23:59:59.999Z");
    }
}
