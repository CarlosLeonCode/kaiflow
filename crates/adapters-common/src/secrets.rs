//! API keys in the operating system's keychain.
//!
//! Built on `keyring-core` plus one credential store per platform: the macOS Keychain, the
//! Windows Credential Manager and, on Linux, the Secret Service (GNOME Keyring, KDE Wallet)
//! over zbus. When no secure store is reachable (typically a Linux session without a Secret
//! Service) the store reports itself unavailable and refuses to keep keys: there is no
//! plain-text, file or in-memory fallback, by design.
//!
//! Entries use the service [`KEYCHAIN_SERVICE`] and the provider name as the user name.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use application::ai::{
    KEYCHAIN_SERVICE, ProviderKind, Secret, SecretAvailability, SecretError, SecretStore,
};
use keyring_core::api::CredentialStoreApi;
use keyring_core::{Entry, Error};

type Store = Arc<dyn CredentialStoreApi + Send + Sync>;

/// User name of the entry used to find out whether the store is reachable.
const PROBE_USER: &str = "availability-probe";

enum Backend {
    Ready(Store),
    Unavailable(String),
}

pub struct KeyringSecretStore {
    backend: Backend,
    /// Entries are specifiers: creating them is cheap, but reusing them keeps one handle per
    /// provider (and lets in-memory stores used in tests behave like real ones).
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    /// The Secret Service may start after the app: an unreachable store is probed again.
    reachable: Mutex<Option<bool>>,
}

impl KeyringSecretStore {
    /// The store of this platform. Never fails: problems become
    /// [`SecretAvailability::Unavailable`].
    pub fn native() -> Self {
        match native_store() {
            Ok(store) => Self::with_store(store),
            Err(reason) => Self {
                backend: Backend::Unavailable(reason),
                entries: Mutex::default(),
                reachable: Mutex::new(Some(false)),
            },
        }
    }

    /// Any credential store (tests use the in-memory one of `keyring-core`).
    pub fn with_store(store: Store) -> Self {
        Self {
            backend: Backend::Ready(store),
            entries: Mutex::default(),
            reachable: Mutex::new(None),
        }
    }

    fn store(&self) -> Result<&Store, SecretError> {
        match &self.backend {
            Backend::Ready(store) => Ok(store),
            Backend::Unavailable(reason) => Err(SecretError::Unavailable(reason.clone())),
        }
    }

    fn entry(&self, user: &str) -> Result<Arc<Entry>, SecretError> {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(entry) = entries.get(user) {
            return Ok(entry.clone());
        }
        let entry = Arc::new(
            self.store()?
                .build(KEYCHAIN_SERVICE, user, None)
                .map_err(map_error)?,
        );
        entries.insert(user.to_owned(), entry.clone());
        Ok(entry)
    }
}

impl SecretStore for KeyringSecretStore {
    fn availability(&self) -> SecretAvailability {
        if let Backend::Unavailable(reason) = &self.backend {
            return SecretAvailability::Unavailable(reason.clone());
        }
        let mut cached = self
            .reachable
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if *cached == Some(true) {
            return SecretAvailability::Available;
        }
        // Reading an entry that does not exist is the cheapest way to touch the store.
        let outcome = self.entry(PROBE_USER).and_then(|e| {
            e.get_password()
                .map(|_| ())
                .or_else(ignore_missing)
                .map_err(map_error)
        });
        match outcome {
            Ok(()) => {
                *cached = Some(true);
                SecretAvailability::Available
            }
            Err(error) => {
                *cached = Some(false);
                SecretAvailability::Unavailable(error.to_string())
            }
        }
    }

    fn get(&self, provider: ProviderKind) -> Result<Option<Secret>, SecretError> {
        match self.entry(provider.as_str())?.get_password() {
            Ok(value) => Ok(Some(Secret::new(value))),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(map_error(error)),
        }
    }

    fn set(&self, provider: ProviderKind, secret: &Secret) -> Result<(), SecretError> {
        self.entry(provider.as_str())?
            .set_password(secret.expose())
            .map_err(map_error)
    }

    fn delete(&self, provider: ProviderKind) -> Result<(), SecretError> {
        match self.entry(provider.as_str())?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(map_error(error)),
        }
    }
}

fn ignore_missing(error: Error) -> Result<(), Error> {
    match error {
        Error::NoEntry => Ok(()),
        other => Err(other),
    }
}

/// Errors of the store, said without echoing anything that came from the secret.
fn map_error(error: Error) -> SecretError {
    match error {
        Error::NoStorageAccess(_) | Error::PlatformFailure(_) | Error::NoDefaultStore => {
            SecretError::Unavailable(unreachable_reason(&error))
        }
        Error::TooLong(..) | Error::Invalid(..) => {
            SecretError::Failed("the keychain refused this key".into())
        }
        _ => SecretError::Failed("the keychain could not complete the operation".into()),
    }
}

fn unreachable_reason(error: &Error) -> String {
    match error {
        Error::NoStorageAccess(_) => "the system keychain is locked or not accessible".to_owned(),
        _ if cfg!(target_os = "linux") => {
            "no Secret Service (GNOME Keyring, KDE Wallet) is running in this session".to_owned()
        }
        _ => "the system keychain could not be reached".to_owned(),
    }
}

#[cfg(target_os = "macos")]
fn native_store() -> Result<Store, String> {
    apple_native_keyring_store::keychain::Store::new()
        .map(|s| s as Store)
        .map_err(|e| format!("the macOS Keychain could not be opened ({e})"))
}

#[cfg(target_os = "windows")]
fn native_store() -> Result<Store, String> {
    windows_native_keyring_store::Store::new()
        .map(|s| s as Store)
        .map_err(|e| format!("the Windows Credential Manager could not be opened ({e})"))
}

#[cfg(target_os = "linux")]
fn native_store() -> Result<Store, String> {
    zbus_secret_service_keyring_store::Store::new()
        .map(|s| s as Store)
        .map_err(|_| {
            "no Secret Service (GNOME Keyring, KDE Wallet) is running in this session".to_owned()
        })
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn native_store() -> Result<Store, String> {
    Err("this platform has no supported secure key store".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock() -> KeyringSecretStore {
        KeyringSecretStore::with_store(keyring_core::mock::Store::new().unwrap())
    }

    #[test]
    fn keys_round_trip_per_provider_and_can_be_deleted() {
        let store = mock();
        assert_eq!(store.availability(), SecretAvailability::Available);
        assert_eq!(store.get(ProviderKind::Anthropic).unwrap(), None);

        store
            .set(ProviderKind::Anthropic, &Secret::new("sk-ant-1"))
            .unwrap();
        store
            .set(ProviderKind::OpenAi, &Secret::new("sk-oai-1"))
            .unwrap();
        assert_eq!(
            store
                .get(ProviderKind::Anthropic)
                .unwrap()
                .unwrap()
                .expose(),
            "sk-ant-1"
        );
        assert_eq!(
            store.get(ProviderKind::OpenAi).unwrap().unwrap().expose(),
            "sk-oai-1"
        );
        store
            .set(ProviderKind::Anthropic, &Secret::new("sk-ant-2"))
            .unwrap();
        assert_eq!(
            store
                .get(ProviderKind::Anthropic)
                .unwrap()
                .unwrap()
                .expose(),
            "sk-ant-2",
            "a new key replaces the old one"
        );

        store.delete(ProviderKind::Anthropic).unwrap();
        assert_eq!(store.get(ProviderKind::Anthropic).unwrap(), None);
        store.delete(ProviderKind::Anthropic).unwrap();
        assert!(store.get(ProviderKind::OpenAi).unwrap().is_some());
    }

    #[test]
    fn a_missing_secure_store_refuses_every_operation_and_keeps_nothing() {
        let store = KeyringSecretStore {
            backend: Backend::Unavailable("no Secret Service".into()),
            entries: Mutex::default(),
            reachable: Mutex::new(Some(false)),
        };
        assert_eq!(
            store.availability(),
            SecretAvailability::Unavailable("no Secret Service".into())
        );
        let refused = store.set(ProviderKind::Gemini, &Secret::new("AIza-secret-1"));
        assert_eq!(
            refused,
            Err(SecretError::Unavailable("no Secret Service".into()))
        );
        assert!(matches!(
            store.get(ProviderKind::Gemini),
            Err(SecretError::Unavailable(_))
        ));
        assert!(matches!(
            store.delete(ProviderKind::Gemini),
            Err(SecretError::Unavailable(_))
        ));
    }

    #[test]
    fn store_failures_never_echo_the_key() {
        let store = mock();
        let entry = store.entry("gemini").unwrap();
        let cred: &keyring_core::mock::Cred = entry.as_any().downcast_ref().unwrap();
        cred.set_error(Error::Invalid(
            "password".into(),
            "AIza-secret-1 is bad".into(),
        ));
        let error = store
            .set(ProviderKind::Gemini, &Secret::new("AIza-secret-1"))
            .unwrap_err();
        assert!(!error.to_string().contains("AIza-secret-1"));
    }
}
