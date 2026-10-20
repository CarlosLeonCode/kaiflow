//! Idle counter. `GetLastInputInfo` reports the 32-bit tick count of the last input, which
//! wraps every ~49.7 days, while `GetTickCount64` does not; the difference is computed in
//! wrapping 32-bit arithmetic so a wrap between the two readings stays correct.

/// Milliseconds since the last input.
pub fn idle_millis(now_tick: u64, last_input_tick: u32) -> u32 {
    // Truncation is the point: compare in the same 32-bit domain as `dwTime`.
    #[allow(clippy::cast_possible_truncation)]
    let now = now_tick as u32;
    now.wrapping_sub(last_input_tick)
}

pub fn idle_seconds(now_tick: u64, last_input_tick: u32) -> f64 {
    f64::from(idle_millis(now_tick, last_input_tick)) / 1000.0
}

#[cfg(windows)]
pub use win::WinIdle;

#[cfg(windows)]
mod win {
    use application::ports::IdleProvider;
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    /// Session-wide idle counter. Needs no permission.
    #[derive(Debug, Default, Clone, Copy)]
    pub struct WinIdle;

    impl IdleProvider for WinIdle {
        fn seconds_since_input(&self) -> f64 {
            let mut info = LASTINPUTINFO {
                cbSize: size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            // SAFETY: `info` is a valid, initialized LASTINPUTINFO with `cbSize` set.
            if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
                return 0.0;
            }
            // SAFETY: no arguments, cannot fail.
            let now = unsafe { GetTickCount64() };
            super::idle_seconds(now, info.dwTime)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_is_the_tick_difference() {
        assert_eq!(idle_millis(10_000, 4_000), 6_000);
        assert!((idle_seconds(10_000, 4_000) - 6.0).abs() < f64::EPSILON);
    }

    #[test]
    fn a_wrapped_32_bit_counter_still_gives_the_right_difference() {
        // Last input just before the 32-bit wrap, now just after it.
        let last = u32::MAX - 999;
        let now = (1_u64 << 32) + 500;
        assert_eq!(idle_millis(now, last), 1_500);
    }

    #[test]
    fn input_in_the_current_tick_is_zero() {
        assert_eq!(idle_millis(5_000_000_000, 5_000_000_000_u64 as u32), 0);
    }

    #[cfg(windows)]
    #[test]
    fn the_os_counter_is_readable() {
        use application::ports::IdleProvider;
        assert!(WinIdle.seconds_since_input() >= 0.0);
    }
}
