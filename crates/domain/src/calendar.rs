//! Local-calendar facts the domain needs without owning a clock or a time zone.

/// The local hour a UTC instant falls in, as reported by a `Calendar` adapter.
///
/// `next_boundary` is the first instant of the following local hour, so a span can be cut hour
/// by hour without assuming that hours are 60 minutes long (DST transitions, half-hour zones).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HourSlot {
    /// Local weekday, 0 = Monday .. 6 = Sunday.
    pub weekday: u8,
    /// Local hour of the day, 0..=23.
    pub hour: u8,
    pub next_boundary: crate::UtcMs,
}
