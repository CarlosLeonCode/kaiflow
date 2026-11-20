//! Text the shell shows outside the webview: the tray menu, system notifications, window
//! titles, native dialog filters and AI error messages. The webview has its own catalog
//! (`src/shared/i18n/en.ts`, `es.ts`); the Spanish terms here are the ones it uses.
//!
//! One [`Messages`] value per language, every field required: a message added to the struct
//! and missing from a language does not compile, like the frontend's typed `Messages`.
//! Messages with values are plain functions, so plurals and word order stay per language.
//!
//! Which language to use comes from [`application::language::UiLanguage`]; logs, diagnostics
//! and machine codes sent over IPC stay in English and never go through here.

use application::ai::AiError;
use application::language::Language;

/// Every user-facing string produced in Rust, for one language.
pub struct Messages {
    // ---- tray / menu bar menu ----
    pub tray_pause: &'static str,
    pub tray_resume: &'static str,
    pub tray_start: &'static str,
    pub tray_open: &'static str,
    pub tray_quit: &'static str,

    // ---- windows and native dialogs ----
    /// Title of the first-run window (the others are titled with the app name).
    pub onboarding_window_title: &'static str,
    /// File type shown in the open dialog of a restore.
    pub restore_file_filter: &'static str,

    // ---- idle return ----
    pub idle_title: &'static str,
    /// Body for an absence of `minutes` whole minutes (0 is "less than a minute").
    pub idle_body: fn(minutes: i64) -> String,

    // ---- Accessibility revoked (macOS) ----
    pub revoked_title: &'static str,
    pub revoked_body: &'static str,

    // ---- goals ----
    pub goal_reached_title: &'static str,
    pub goal_reached_body: fn(label: &str) -> String,
    pub limit_passed_title: &'static str,
    pub limit_passed_body: fn(label: &str) -> String,

    // ---- focus blocks ----
    pub drift_title: &'static str,
    /// `intent` may be empty: then the body only names the app.
    pub drift_body: fn(app: &str, intent: &str) -> String,
    pub focus_done_title: &'static str,
    pub timer_done_title: &'static str,
    pub break_done_title: &'static str,
    pub break_started: fn(minutes: i64) -> String,
    pub break_offered: fn(minutes: i64) -> String,
    pub next_block_started: fn(minutes: i64) -> String,
    pub another_block_offered: fn(minutes: i64) -> String,
    pub ready_when_you_are: &'static str,
    pub nice_work: &'static str,
    /// The task name in front of what comes next.
    pub with_task: fn(task: &str, next: &str) -> String,
    pub heads_up_title: &'static str,
    pub heads_up_break: &'static str,
    pub heads_up_wrap_up: &'static str,
    pub heads_up_wrap_up_task: fn(task: &str) -> String,

    // ---- AI review ----
    /// Written for the user and never carries the key (`AppError::Ai.message`).
    pub ai_error: fn(&AiError) -> String,
}

/// The catalog for `language`.
pub const fn messages(language: Language) -> &'static Messages {
    match language {
        Language::En => &EN,
        Language::Es => &ES,
    }
}

pub static EN: Messages = Messages {
    tray_pause: "Pause tracking",
    tray_resume: "Resume tracking",
    tray_start: "Start tracking",
    tray_open: "Open Kaiflow",
    tray_quit: "Quit",

    onboarding_window_title: "Welcome to Kaiflow",
    restore_file_filter: "Kaiflow backup or export",

    idle_title: "Welcome back",
    idle_body: |minutes| {
        let away = match minutes {
            ..=0 => "less than a minute".to_owned(),
            1 => "1 minute".to_owned(),
            n => format!("{n} minutes"),
        };
        format!("You were away for {away}. Choose what to do with that time.")
    },

    revoked_title: "Accessibility access was turned off",
    revoked_body: "Kaiflow keeps recording app names but not window titles. \
                   Open the app to restore access.",

    goal_reached_title: "Goal reached",
    goal_reached_body: |label| format!("You reached your goal: {label}."),
    limit_passed_title: "Limit passed",
    limit_passed_body: |label| format!("You went over your limit: {label}."),

    drift_title: "Still on track?",
    drift_body: |app, intent| {
        if intent.is_empty() {
            format!("You have been in {app} for a while.")
        } else {
            format!("You have been in {app} for a while. Your focus: {intent}.")
        }
    },
    focus_done_title: "Focus block done",
    timer_done_title: "Time is up",
    break_done_title: "Break is over",
    // "a 5-minute break": the English adjective never takes a plural.
    break_started: |minutes| format!("Your {minutes}-minute break has started."),
    break_offered: |minutes| format!("Time for a {minutes}-minute break."),
    next_block_started: |minutes| format!("Your next {minutes}-minute block has started."),
    another_block_offered: |minutes| match minutes {
        1 => "Ready for another 1 minute?".to_owned(),
        n => format!("Ready for another {n} minutes?"),
    },
    ready_when_you_are: "Ready when you are.",
    nice_work: "Nice work.",
    with_task: |task, next| format!("{task}. {next}"),
    heads_up_title: "One minute left",
    heads_up_break: "Your break ends in a minute.",
    heads_up_wrap_up: "Time to wrap up.",
    heads_up_wrap_up_task: |task| format!("Time to wrap up: {task}."),

    // The English text is the error's own `Display`, which logs and tests also use.
    ai_error: |error| error.to_string(),
};

pub static ES: Messages = Messages {
    tray_pause: "Pausar registro",
    tray_resume: "Reanudar registro",
    tray_start: "Iniciar registro",
    tray_open: "Abrir Kaiflow",
    tray_quit: "Salir",

    onboarding_window_title: "Te damos la bienvenida a Kaiflow",
    restore_file_filter: "Copia de seguridad o exportación de Kaiflow",

    idle_title: "Hola de nuevo",
    idle_body: |minutes| {
        let away = match minutes {
            ..=0 => "menos de un minuto".to_owned(),
            n => es_minutes(n),
        };
        format!("Estuviste ausente durante {away}. Elige qué hacer con ese tiempo.")
    },

    revoked_title: "Se desactivó el acceso de Accesibilidad",
    revoked_body: "Kaiflow sigue registrando los nombres de las apps, pero no los títulos de \
                   las ventanas. Abre la app para restablecer el acceso.",

    goal_reached_title: "Objetivo cumplido",
    goal_reached_body: |label| format!("Cumpliste tu objetivo: {label}."),
    limit_passed_title: "Límite superado",
    limit_passed_body: |label| format!("Superaste tu límite: {label}."),

    drift_title: "¿Sigues con la tarea?",
    drift_body: |app, intent| {
        if intent.is_empty() {
            format!("Llevas un rato en {app}.")
        } else {
            format!("Llevas un rato en {app}. Tu enfoque: {intent}.")
        }
    },
    focus_done_title: "Enfoque completado",
    timer_done_title: "Se acabó el tiempo",
    break_done_title: "Se acabó el descanso",
    break_started: |minutes| format!("Empezó tu descanso de {}.", es_minutes(minutes)),
    break_offered: |minutes| format!("Es hora de un descanso de {}.", es_minutes(minutes)),
    next_block_started: |minutes| format!("Empezó tu siguiente bloque de {}.", es_minutes(minutes)),
    another_block_offered: |minutes| match minutes {
        1 => "¿Seguimos con otro minuto?".to_owned(),
        n => format!("¿Seguimos con otros {n} minutos?"),
    },
    ready_when_you_are: "Sigue cuando quieras.",
    nice_work: "Buen trabajo.",
    with_task: |task, next| format!("{task}. {next}"),
    heads_up_title: "Queda un minuto",
    heads_up_break: "Tu descanso termina en un minuto.",
    heads_up_wrap_up: "Es hora de ir cerrando.",
    heads_up_wrap_up_task: |task| format!("Es hora de ir cerrando: {task}."),

    ai_error: es_ai_error,
};

/// `1 minuto`, `5 minutos`.
fn es_minutes(minutes: i64) -> String {
    match minutes {
        1 => "1 minuto".to_owned(),
        n => format!("{n} minutos"),
    }
}

/// Exhaustive on purpose: a new `AiError` variant has to be worded here too.
fn es_ai_error(error: &AiError) -> String {
    match error {
        AiError::Offline => "No se pudo conectar con el proveedor. Revisa tu conexión a \
                             internet y vuelve a intentarlo."
            .to_owned(),
        AiError::Timeout => "El proveedor tardó demasiado en responder. No se guardó nada; \
                             vuelve a intentarlo en un momento."
            .to_owned(),
        AiError::RateLimited {
            retry_after_secs: Some(1),
        } => "El proveedor está limitando las solicitudes ahora mismo (HTTP 429). Vuelve a \
              intentarlo en un segundo."
            .to_owned(),
        AiError::RateLimited {
            retry_after_secs: Some(secs),
        } => format!(
            "El proveedor está limitando las solicitudes ahora mismo (HTTP 429). Vuelve a \
             intentarlo en unos {secs} segundos."
        ),
        AiError::RateLimited {
            retry_after_secs: None,
        } => "El proveedor está limitando las solicitudes ahora mismo (HTTP 429). Espera un \
              poco y vuelve a intentarlo."
            .to_owned(),
        AiError::Unauthorized => {
            "El proveedor rechazó la clave de API. Revísala y vuelve a guardarla.".to_owned()
        }
        AiError::RemoteHostRejected => "Ollama debe funcionar en este equipo: solo se permiten \
                                        direcciones localhost."
            .to_owned(),
        AiError::Provider { status, message } => {
            format!("El proveedor devolvió un error (HTTP {status}): {message}")
        }
        AiError::BadResponse(detail) => {
            format!("No se pudo leer la respuesta del proveedor: {detail}")
        }
        AiError::Cancelled => "Se canceló el análisis.".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_ai_error() -> Vec<AiError> {
        vec![
            AiError::Offline,
            AiError::Timeout,
            AiError::RateLimited {
                retry_after_secs: Some(30),
            },
            AiError::RateLimited {
                retry_after_secs: Some(1),
            },
            AiError::RateLimited {
                retry_after_secs: None,
            },
            AiError::Unauthorized,
            AiError::RemoteHostRejected,
            AiError::Provider {
                status: 500,
                message: "overloaded".into(),
            },
            AiError::BadResponse("not JSON".into()),
            AiError::Cancelled,
        ]
    }

    /// Every message of `m`, rendered with sample values, labeled for failures.
    fn rendered(m: &Messages) -> Vec<(&'static str, String)> {
        let mut all = vec![
            ("tray_pause", m.tray_pause.to_owned()),
            ("tray_resume", m.tray_resume.to_owned()),
            ("tray_start", m.tray_start.to_owned()),
            ("tray_open", m.tray_open.to_owned()),
            ("tray_quit", m.tray_quit.to_owned()),
            (
                "onboarding_window_title",
                m.onboarding_window_title.to_owned(),
            ),
            ("restore_file_filter", m.restore_file_filter.to_owned()),
            ("idle_title", m.idle_title.to_owned()),
            ("idle_body", (m.idle_body)(7)),
            ("revoked_title", m.revoked_title.to_owned()),
            ("revoked_body", m.revoked_body.to_owned()),
            ("goal_reached_title", m.goal_reached_title.to_owned()),
            ("goal_reached_body", (m.goal_reached_body)("Deep work")),
            ("limit_passed_title", m.limit_passed_title.to_owned()),
            ("limit_passed_body", (m.limit_passed_body)("Email")),
            ("drift_title", m.drift_title.to_owned()),
            ("drift_body", (m.drift_body)("Slack", "Write report")),
            ("focus_done_title", m.focus_done_title.to_owned()),
            ("timer_done_title", m.timer_done_title.to_owned()),
            ("break_done_title", m.break_done_title.to_owned()),
            ("break_started", (m.break_started)(5)),
            ("break_offered", (m.break_offered)(5)),
            ("next_block_started", (m.next_block_started)(50)),
            ("another_block_offered", (m.another_block_offered)(25)),
            ("ready_when_you_are", m.ready_when_you_are.to_owned()),
            ("nice_work", m.nice_work.to_owned()),
            ("with_task", (m.with_task)("Write report", "Nice work.")),
            ("heads_up_title", m.heads_up_title.to_owned()),
            ("heads_up_break", m.heads_up_break.to_owned()),
            ("heads_up_wrap_up", m.heads_up_wrap_up.to_owned()),
            (
                "heads_up_wrap_up_task",
                (m.heads_up_wrap_up_task)("Write report"),
            ),
        ];
        all.extend(
            every_ai_error()
                .iter()
                .map(|error| ("ai_error", (m.ai_error)(error))),
        );
        all
    }

    #[test]
    fn every_message_exists_in_both_languages_and_spanish_is_translated() {
        let (en, es) = (rendered(&EN), rendered(&ES));
        assert_eq!(en.len(), es.len());
        for ((key, en), (_, es)) in en.iter().zip(&es) {
            assert!(!en.trim().is_empty(), "{key} is empty in English");
            assert!(!es.trim().is_empty(), "{key} is empty in Spanish");
            // Only the brand-only and value-only messages may read the same.
            if !["tray_open", "with_task"].contains(key) {
                assert_ne!(en, es, "{key} is not translated");
            }
        }
    }

    #[test]
    fn the_language_picks_its_catalog() {
        assert_eq!(messages(Language::En).tray_pause, "Pause tracking");
        assert_eq!(messages(Language::Es).tray_pause, "Pausar registro");
    }

    #[test]
    fn values_are_interpolated_in_both_languages() {
        for language in Language::ALL {
            let m = messages(language);
            assert!((m.goal_reached_body)("Deep work").contains("Deep work"));
            assert!((m.limit_passed_body)("Email").contains("Email"));
            let drift = (m.drift_body)("Slack", "Write report");
            assert!(drift.contains("Slack") && drift.contains("Write report"));
            assert!(!(m.drift_body)("Slack", "").contains(':'));
            assert!((m.heads_up_wrap_up_task)("Write report").contains("Write report"));
            assert!((m.idle_body)(20).contains("20"));
        }
    }

    #[test]
    fn plurals_follow_each_language() {
        assert_eq!(
            (EN.idle_body)(0),
            "You were away for less than a minute. Choose what to do with that time."
        );
        assert!((EN.idle_body)(1).contains("for 1 minute."));
        assert!((EN.idle_body)(2).contains("for 2 minutes."));
        assert_eq!(
            (ES.idle_body)(0),
            "Estuviste ausente durante menos de un minuto. Elige qué hacer con ese tiempo."
        );
        assert!((ES.idle_body)(1).contains("durante 1 minuto."));
        assert!((ES.idle_body)(2).contains("durante 2 minutos."));

        // English uses an invariable adjective ("5-minute"); Spanish needs the plural.
        assert_eq!((EN.break_started)(1), "Your 1-minute break has started.");
        assert_eq!((ES.break_started)(1), "Empezó tu descanso de 1 minuto.");
        assert_eq!(
            (ES.break_offered)(5),
            "Es hora de un descanso de 5 minutos."
        );
        assert_eq!(
            (ES.next_block_started)(50),
            "Empezó tu siguiente bloque de 50 minutos."
        );
        assert_eq!((EN.another_block_offered)(1), "Ready for another 1 minute?");
        assert_eq!(
            (EN.another_block_offered)(25),
            "Ready for another 25 minutes?"
        );
        assert_eq!((ES.another_block_offered)(1), "¿Seguimos con otro minuto?");
        assert_eq!(
            (ES.another_block_offered)(25),
            "¿Seguimos con otros 25 minutos?"
        );
        let retry = |secs| AiError::RateLimited {
            retry_after_secs: Some(secs),
        };
        assert!((ES.ai_error)(&retry(1)).ends_with("en un segundo."));
        assert!((ES.ai_error)(&retry(30)).ends_with("en unos 30 segundos."));
    }

    #[test]
    fn english_ai_errors_are_the_errors_own_text() {
        for error in every_ai_error() {
            assert_eq!((EN.ai_error)(&error), error.to_string());
        }
        let provider = AiError::Provider {
            status: 503,
            message: "busy".into(),
        };
        assert_eq!(
            (ES.ai_error)(&provider),
            "El proveedor devolvió un error (HTTP 503): busy"
        );
    }
}
