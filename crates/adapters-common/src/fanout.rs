//! Delivery of OS notifications (sleep, wake, lock...) that arrive on a background thread
//! before or after the engine subscribes. The listener threads are started when the
//! providers are built; `compose` subscribes the engine channel later.

use std::sync::{Arc, Mutex, PoisonError};

use application::ports::{PowerEventsProvider, SystemSignal};
use crossbeam_channel::Sender;

/// Shared list of subscribers; cloning shares the list.
#[derive(Debug, Clone, Default)]
pub struct SignalFanout(Arc<Mutex<Vec<Sender<SystemSignal>>>>);

impl SignalFanout {
    pub fn new() -> Self {
        Self::default()
    }

    /// Sends `signal` to every live subscriber and drops the ones whose receiver is gone.
    /// Signals sent before anyone subscribed are dropped (the engine has nothing to pause).
    pub fn send(&self, signal: SystemSignal) {
        let mut subscribers = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        subscribers.retain(|tx| tx.send(signal.clone()).is_ok());
    }

    pub fn subscriber_count(&self) -> usize {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).len()
    }
}

impl PowerEventsProvider for SignalFanout {
    fn subscribe(&self, tx: Sender<SystemSignal>) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(tx);
    }
}

#[cfg(test)]
mod tests {
    use crossbeam_channel::unbounded;

    use super::*;

    #[test]
    fn every_subscriber_receives_the_signal() {
        let fanout = SignalFanout::new();
        let (a, a_rx) = unbounded();
        let (b, b_rx) = unbounded();
        fanout.subscribe(a);
        fanout.clone().subscribe(b);
        fanout.send(SystemSignal::ScreenLocked);
        assert_eq!(a_rx.try_recv(), Ok(SystemSignal::ScreenLocked));
        assert_eq!(b_rx.try_recv(), Ok(SystemSignal::ScreenLocked));
    }

    #[test]
    fn signals_before_subscription_are_dropped_and_dead_receivers_are_pruned() {
        let fanout = SignalFanout::new();
        fanout.send(SystemSignal::WillSleep);
        let (tx, rx) = unbounded();
        fanout.subscribe(tx);
        assert!(rx.try_recv().is_err());
        drop(rx);
        fanout.send(SystemSignal::DidWake);
        assert_eq!(fanout.subscriber_count(), 0);
    }
}
