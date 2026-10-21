//! Moves API keys stored under the keychain service used before the rename to Kaiflow.
//!
//! [`MigratingSecretStore`] wraps the current store and the legacy one. A key missing from
//! the current store is looked up once per provider and run in the legacy store; when found
//! it is copied over, and the legacy entry is deleted only after that write succeeded.
//! Writes always go to the current store; deletes clear both, so a key the user removed can
//! never come back from the legacy entry.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, PoisonError};

use crate::ai::{ProviderKind, Secret, SecretAvailability, SecretError, SecretStore};

pub struct MigratingSecretStore {
    current: Arc<dyn SecretStore>,
    legacy: Arc<dyn SecretStore>,
    /// Providers whose legacy entry was already looked up in this run.
    checked: Mutex<HashSet<ProviderKind>>,
}

impl MigratingSecretStore {
    pub fn new(current: Arc<dyn SecretStore>, legacy: Arc<dyn SecretStore>) -> Self {
        Self {
            current,
            legacy,
            checked: Mutex::default(),
        }
    }

    /// `true` the first time it is asked for `provider`.
    fn first_look(&self, provider: ProviderKind) -> bool {
        self.checked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(provider)
    }

    fn migrate(&self, provider: ProviderKind) -> Option<Secret> {
        // A legacy store that cannot be read is no reason to fail: the key is simply absent.
        let secret = self.legacy.get(provider).ok().flatten()?;
        // The old entry goes only once the new one holds the key; if either step fails the
        // key keeps working this run and the move is tried again on the next launch.
        if self.current.set(provider, &secret).is_ok() {
            let _ = self.legacy.delete(provider);
        }
        Some(secret)
    }
}

impl SecretStore for MigratingSecretStore {
    fn availability(&self) -> SecretAvailability {
        self.current.availability()
    }

    fn get(&self, provider: ProviderKind) -> Result<Option<Secret>, SecretError> {
        if let Some(secret) = self.current.get(provider)? {
            return Ok(Some(secret));
        }
        if !self.first_look(provider) {
            return Ok(None);
        }
        Ok(self.migrate(provider))
    }

    fn set(&self, provider: ProviderKind, secret: &Secret) -> Result<(), SecretError> {
        self.current.set(provider, secret)
    }

    fn delete(&self, provider: ProviderKind) -> Result<(), SecretError> {
        self.current.delete(provider)?;
        self.legacy.delete(provider)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::FakeSecrets;

    fn rig() -> (MigratingSecretStore, FakeSecrets, FakeSecrets) {
        let current = FakeSecrets::default();
        let legacy = FakeSecrets::default();
        let store = MigratingSecretStore::new(Arc::new(current.clone()), Arc::new(legacy.clone()));
        (store, current, legacy)
    }

    #[test]
    fn a_legacy_key_is_moved_on_first_read() {
        let (store, current, legacy) = rig();
        legacy.put(ProviderKind::Anthropic, "sk-ant-old");

        let key = store.get(ProviderKind::Anthropic).unwrap().unwrap();
        assert_eq!(key.expose(), "sk-ant-old");
        assert_eq!(
            current.stored(ProviderKind::Anthropic).as_deref(),
            Some("sk-ant-old")
        );
        assert_eq!(legacy.stored(ProviderKind::Anthropic), None);
        assert_eq!(
            store
                .get(ProviderKind::Anthropic)
                .unwrap()
                .unwrap()
                .expose(),
            "sk-ant-old"
        );
    }

    #[test]
    fn the_current_key_wins_and_the_legacy_store_is_not_touched() {
        let (store, current, legacy) = rig();
        current.put(ProviderKind::OpenAi, "sk-new");
        legacy.put(ProviderKind::OpenAi, "sk-old");

        assert_eq!(
            store.get(ProviderKind::OpenAi).unwrap().unwrap().expose(),
            "sk-new"
        );
        assert_eq!(legacy.touched(), 0);
    }

    #[test]
    fn a_failed_write_keeps_the_legacy_key() {
        let (store, current, legacy) = rig();
        legacy.put(ProviderKind::Gemini, "AIza-old");
        current.refuse_writes();

        let key = store.get(ProviderKind::Gemini).unwrap().unwrap();
        assert_eq!(key.expose(), "AIza-old", "the key still works this run");
        assert_eq!(current.stored(ProviderKind::Gemini), None);
        assert_eq!(
            legacy.stored(ProviderKind::Gemini).as_deref(),
            Some("AIza-old"),
            "nothing is deleted before a successful write"
        );
    }

    #[test]
    fn the_legacy_store_is_asked_once_per_provider() {
        let (store, _current, legacy) = rig();
        assert_eq!(store.get(ProviderKind::Anthropic).unwrap(), None);
        assert_eq!(store.get(ProviderKind::Anthropic).unwrap(), None);
        assert_eq!(legacy.touched(), 1);
    }

    #[test]
    fn an_unreadable_legacy_store_reads_as_no_key() {
        let current = FakeSecrets::default();
        let store = MigratingSecretStore::new(
            Arc::new(current),
            Arc::new(FakeSecrets::unavailable("locked")),
        );
        assert_eq!(store.get(ProviderKind::Anthropic).unwrap(), None);
    }

    #[test]
    fn delete_clears_both_entries_and_set_writes_the_current_one() {
        let (store, current, legacy) = rig();
        legacy.put(ProviderKind::OpenAi, "sk-old");
        store
            .set(ProviderKind::OpenAi, &Secret::new("sk-new"))
            .unwrap();
        assert_eq!(
            current.stored(ProviderKind::OpenAi).as_deref(),
            Some("sk-new")
        );

        store.delete(ProviderKind::OpenAi).unwrap();
        assert_eq!(current.stored(ProviderKind::OpenAi), None);
        assert_eq!(legacy.stored(ProviderKind::OpenAi), None);
        assert_eq!(store.get(ProviderKind::OpenAi).unwrap(), None);
    }
}
