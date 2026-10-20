//! Mapping of the platform's "may we read window titles?" answer to the domain state.

use domain::PermissionState;

/// `true` (titles can be read) is `Granted`; anything else degrades tracking.
pub fn state_from_trusted(trusted: bool) -> PermissionState {
    if trusted {
        PermissionState::Granted
    } else {
        PermissionState::Denied
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_maps_to_granted_and_untrusted_to_denied() {
        assert_eq!(state_from_trusted(true), PermissionState::Granted);
        assert_eq!(state_from_trusted(false), PermissionState::Denied);
    }
}
