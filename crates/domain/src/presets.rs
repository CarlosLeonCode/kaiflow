//! Opt-in activity presets and pure app suggestions.
//!
//! Presets are a catalog in code. Nothing here is ever applied on its own: a pack only creates
//! activities when the user picks it, and a suggestion only becomes a rule when accepted.
//! The catalog is role-agnostic: a generic pack plus a few neutral role examples, none of
//! them preselected.
//!
//! App hints cover the three identity schemes the platform adapters produce: macOS bundle ids,
//! Windows lowercase executable names and Linux lowercase `WM_CLASS` classes.

use crate::activity::{ActivityRule, Productivity, RuleKind};

/// How apps map to one preset activity.
#[derive(Debug, PartialEq, Eq)]
pub struct AppHints {
    /// macOS bundle ids, e.g. `com.microsoft.VSCode`.
    pub macos: &'static [&'static str],
    /// Windows executable names, e.g. `code.exe`.
    pub windows: &'static [&'static str],
    /// Linux `WM_CLASS` classes, e.g. `code`.
    pub linux: &'static [&'static str],
    /// Lowercase whole words found in the app name or id, e.g. `figma`.
    pub name_tokens: &'static [&'static str],
}

/// One activity a pack proposes.
#[derive(Debug, PartialEq, Eq)]
pub struct PresetActivity {
    /// Stable key stored in `activities.preset_key`, `"<pack>.<activity>"`.
    pub key: &'static str,
    pub name: &'static str,
    pub color: &'static str,
    pub productivity: Productivity,
    pub hints: AppHints,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Preset {
    pub key: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub activities: &'static [PresetActivity],
}

const fn hints(
    macos: &'static [&'static str],
    windows: &'static [&'static str],
    linux: &'static [&'static str],
    name_tokens: &'static [&'static str],
) -> AppHints {
    AppHints {
        macos,
        windows,
        linux,
        name_tokens,
    }
}

const fn activity(
    key: &'static str,
    name: &'static str,
    color: &'static str,
    productivity: Productivity,
    hints: AppHints,
) -> PresetActivity {
    PresetActivity {
        key,
        name,
        color,
        productivity,
        hints,
    }
}

/// The whole catalog. The generic pack comes first so everyday apps (browsers, chat) resolve
/// there before any role pack is consulted.
pub static PRESETS: &[Preset] = &[
    Preset {
        key: "general",
        name: "General",
        description: "Everyday apps: browsing, messages, notes and entertainment.",
        activities: &[
            activity(
                "general.browsing",
                "Browsing",
                "#64748b",
                Productivity::Neutral,
                hints(
                    &[
                        "com.apple.Safari",
                        "com.google.Chrome",
                        "org.mozilla.firefox",
                        "com.microsoft.edgemac",
                        "com.brave.Browser",
                        "company.thebrowser.Browser",
                        "com.operasoftware.Opera",
                        "com.vivaldi.Vivaldi",
                    ],
                    &[
                        "chrome.exe",
                        "firefox.exe",
                        "msedge.exe",
                        "brave.exe",
                        "opera.exe",
                        "vivaldi.exe",
                        "iexplore.exe",
                    ],
                    &[
                        "google-chrome",
                        "chromium",
                        "chromium-browser",
                        "firefox",
                        "brave-browser",
                        "microsoft-edge",
                        "vivaldi-stable",
                        "navigator",
                    ],
                    &[
                        "safari", "chrome", "chromium", "firefox", "brave", "vivaldi", "opera",
                    ],
                ),
            ),
            activity(
                "general.communication",
                "Communication",
                "#0ea5e9",
                Productivity::Neutral,
                hints(
                    &[
                        "com.tinyspeck.slackmacgap",
                        "com.microsoft.teams2",
                        "us.zoom.xos",
                        "com.hnc.Discord",
                        "com.apple.mail",
                        "com.apple.MobileSMS",
                        "com.microsoft.Outlook",
                    ],
                    &[
                        "slack.exe",
                        "ms-teams.exe",
                        "teams.exe",
                        "zoom.exe",
                        "discord.exe",
                        "outlook.exe",
                        "thunderbird.exe",
                    ],
                    &["slack", "teams", "zoom", "discord", "thunderbird"],
                    &[
                        "slack",
                        "teams",
                        "zoom",
                        "discord",
                        "outlook",
                        "thunderbird",
                        "telegram",
                        "whatsapp",
                        "signal",
                    ],
                ),
            ),
            activity(
                "general.notes",
                "Notes & documents",
                "#14b8a6",
                Productivity::Neutral,
                hints(
                    &[
                        "notion.id",
                        "md.obsidian",
                        "com.apple.Notes",
                        "com.apple.iWork.Pages",
                        "com.microsoft.Word",
                    ],
                    &["notion.exe", "obsidian.exe", "winword.exe", "onenote.exe"],
                    &["notion-app", "obsidian", "libreoffice-writer", "joplin"],
                    &["notion", "obsidian", "word", "pages", "onenote", "joplin"],
                ),
            ),
            activity(
                "general.entertainment",
                "Entertainment",
                "#f43f5e",
                Productivity::Distracting,
                hints(
                    &[
                        "com.spotify.client",
                        "org.videolan.vlc",
                        "com.apple.Music",
                        "com.apple.TV",
                        "tv.plex.desktop",
                    ],
                    &["spotify.exe", "vlc.exe", "netflix.exe", "steam.exe"],
                    &["spotify", "vlc", "steam"],
                    &["spotify", "netflix", "vlc", "steam", "twitch"],
                ),
            ),
        ],
    },
    Preset {
        key: "development",
        name: "Development",
        description: "Editors, terminals and developer tooling.",
        activities: &[
            activity(
                "development.coding",
                "Coding",
                "#6366f1",
                Productivity::Productive,
                hints(
                    &[
                        "com.microsoft.VSCode",
                        "com.apple.dt.Xcode",
                        "com.jetbrains.intellij",
                        "com.jetbrains.WebStorm",
                        "com.jetbrains.pycharm",
                        "dev.zed.Zed",
                        "com.sublimetext.4",
                        "com.todesktop.230313mzl4w4u92",
                    ],
                    &[
                        "code.exe",
                        "idea64.exe",
                        "webstorm64.exe",
                        "pycharm64.exe",
                        "devenv.exe",
                        "sublime_text.exe",
                        "zed.exe",
                        "cursor.exe",
                    ],
                    &[
                        "code",
                        "jetbrains-idea",
                        "jetbrains-webstorm",
                        "jetbrains-pycharm",
                        "sublime_text",
                        "zed",
                        "cursor",
                    ],
                    &[
                        "vscode", "xcode", "intellij", "webstorm", "pycharm", "neovim", "emacs",
                        "zed", "cursor",
                    ],
                ),
            ),
            activity(
                "development.terminal",
                "Terminal",
                "#22c55e",
                Productivity::Productive,
                hints(
                    &[
                        "com.apple.Terminal",
                        "com.googlecode.iterm2",
                        "org.alacritty",
                        "net.kovidgoyal.kitty",
                        "com.mitchellh.ghostty",
                        "dev.warp.Warp-Stable",
                    ],
                    &[
                        "windowsterminal.exe",
                        "cmd.exe",
                        "powershell.exe",
                        "pwsh.exe",
                        "alacritty.exe",
                        "wezterm-gui.exe",
                    ],
                    &[
                        "gnome-terminal-server",
                        "konsole",
                        "xterm",
                        "alacritty",
                        "kitty",
                        "wezterm",
                        "foot",
                    ],
                    &[
                        "terminal",
                        "iterm2",
                        "alacritty",
                        "kitty",
                        "wezterm",
                        "ghostty",
                    ],
                ),
            ),
            activity(
                "development.tooling",
                "Developer tools",
                "#f59e0b",
                Productivity::Productive,
                hints(
                    &[
                        "com.docker.docker",
                        "com.postmanlabs.mac",
                        "com.github.GitHubClient",
                        "com.tinyapp.TablePlus",
                    ],
                    &["docker desktop.exe", "postman.exe", "githubdesktop.exe"],
                    &["postman", "dbeaver", "gitkraken"],
                    &[
                        "docker",
                        "postman",
                        "github",
                        "tableplus",
                        "dbeaver",
                        "gitkraken",
                    ],
                ),
            ),
        ],
    },
    Preset {
        key: "marketing",
        name: "Marketing",
        description: "Campaigns, social channels and performance reports.",
        activities: &[
            activity(
                "marketing.content",
                "Content & social",
                "#ec4899",
                Productivity::Productive,
                hints(
                    &["com.buffer.Buffer", "com.hootsuite.Hootsuite"],
                    &["buffer.exe", "hootsuite.exe"],
                    &[],
                    &["buffer", "hootsuite", "later", "sprout", "wordpress"],
                ),
            ),
            activity(
                "marketing.campaigns",
                "Campaigns & email",
                "#f97316",
                Productivity::Productive,
                hints(
                    &[],
                    &[],
                    &[],
                    &["mailchimp", "hubspot", "klaviyo", "sendgrid"],
                ),
            ),
            activity(
                "marketing.analytics",
                "Analytics & research",
                "#8b5cf6",
                Productivity::Productive,
                hints(
                    &[],
                    &[],
                    &[],
                    &["analytics", "semrush", "ahrefs", "tableau"],
                ),
            ),
        ],
    },
    Preset {
        key: "accounting",
        name: "Accounting",
        description: "Spreadsheets, bookkeeping software and financial documents.",
        activities: &[
            activity(
                "accounting.spreadsheets",
                "Spreadsheets",
                "#16a34a",
                Productivity::Productive,
                hints(
                    &["com.microsoft.Excel", "com.apple.iWork.Numbers"],
                    &["excel.exe"],
                    &["libreoffice-calc", "gnumeric"],
                    &["excel", "numbers", "calc", "gnumeric"],
                ),
            ),
            activity(
                "accounting.bookkeeping",
                "Bookkeeping",
                "#0891b2",
                Productivity::Productive,
                hints(
                    &["com.intuit.QuickBooks"],
                    &["qbw32.exe", "quickbooks.exe"],
                    &["gnucash"],
                    &[
                        "quickbooks",
                        "xero",
                        "freshbooks",
                        "sage",
                        "gnucash",
                        "wave",
                    ],
                ),
            ),
            activity(
                "accounting.documents",
                "Reports & PDFs",
                "#a16207",
                Productivity::Neutral,
                hints(
                    &["com.adobe.Acrobat.Pro", "com.adobe.Reader"],
                    &["acrord32.exe", "acrobat.exe"],
                    &["evince", "okular"],
                    &["acrobat", "evince", "okular"],
                ),
            ),
        ],
    },
    Preset {
        key: "design",
        name: "Design",
        description: "Design, illustration and video tools.",
        activities: &[
            activity(
                "design.tools",
                "Design tools",
                "#d946ef",
                Productivity::Productive,
                hints(
                    &[
                        "com.figma.Desktop",
                        "com.bohemiancoding.sketch3",
                        "com.canva.CanvaDesktop",
                        "com.adobe.Photoshop",
                        "com.adobe.illustrator",
                        "com.seriflabs.affinitydesigner2",
                    ],
                    &[
                        "figma.exe",
                        "canva.exe",
                        "photoshop.exe",
                        "illustrator.exe",
                        "inkscape.exe",
                    ],
                    &["figma-linux", "inkscape", "gimp", "krita"],
                    &[
                        "figma",
                        "sketch",
                        "canva",
                        "photoshop",
                        "illustrator",
                        "affinity",
                        "inkscape",
                        "gimp",
                        "krita",
                    ],
                ),
            ),
            activity(
                "design.video",
                "Video & motion",
                "#ef4444",
                Productivity::Productive,
                hints(
                    &[
                        "com.adobe.PremierePro",
                        "com.adobe.AfterEffects",
                        "com.blackmagic-design.DaVinciResolve",
                        "org.blenderfoundation.blender",
                    ],
                    &[
                        "premiere pro.exe",
                        "afterfx.exe",
                        "resolve.exe",
                        "blender.exe",
                    ],
                    &["blender", "kdenlive", "shotcut"],
                    &["premiere", "aftereffects", "davinci", "blender", "kdenlive"],
                ),
            ),
        ],
    },
];

/// Pack by key.
pub fn preset(key: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.key == key)
}

/// An app seen in the tracked history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeenApp {
    pub app_id: String,
    pub app_name: String,
}

/// A proposal to file an app under a preset activity. Never applied automatically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Suggestion {
    pub app_id: String,
    pub app_name: String,
    pub pack_key: &'static str,
    pub activity: &'static PresetActivity,
}

fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
}

fn exact_match(hints: &AppHints, app_id: &str) -> bool {
    [hints.macos, hints.windows, hints.linux]
        .into_iter()
        .flatten()
        .any(|known| known.eq_ignore_ascii_case(app_id))
}

fn token_match(hints: &AppHints, app_id: &str, app_name: &str) -> bool {
    tokens(app_name)
        .chain(tokens(app_id))
        .any(|t| hints.name_tokens.contains(&t.as_str()))
}

/// First activity of `packs` for the app: the exact id table wins over name tokens, then
/// catalog order decides.
fn find_in<'a>(
    packs: impl Iterator<Item = &'a Preset>,
    app_id: &str,
    app_name: &str,
) -> Option<(&'a Preset, &'a PresetActivity)> {
    let candidates: Vec<_> = packs
        .flat_map(|p| p.activities.iter().map(move |a| (p, a)))
        .collect();
    candidates
        .iter()
        .find(|(_, a)| exact_match(&a.hints, app_id))
        .or_else(|| {
            candidates
                .iter()
                .find(|(_, a)| token_match(&a.hints, app_id, app_name))
        })
        .copied()
}

/// Pure suggestion for one app: exact id table first, then name tokens; `None` when nothing
/// matches. Browsers resolve to the neutral "Browsing" activity.
pub fn suggest(app_id: &str, app_name: &str) -> Option<(&'static Preset, &'static PresetActivity)> {
    find_in(PRESETS.iter(), app_id, app_name)
}

/// The activity of `pack` this app belongs to, if any.
pub fn match_in_pack(
    pack: &'static Preset,
    app_id: &str,
    app_name: &str,
) -> Option<&'static PresetActivity> {
    find_in(std::iter::once(pack), app_id, app_name).map(|(_, a)| a)
}

/// Whether some rule already files this app: an app rule for it, or a title rule scoped to it.
pub fn has_rule_for(app_id: &str, rules: &[ActivityRule]) -> bool {
    rules.iter().any(|r| match &r.kind {
        RuleKind::App(bundle) => bundle == app_id,
        RuleKind::TitlePattern { app_id: scoped, .. } => scoped.as_deref() == Some(app_id),
    })
}

/// Suggestions for the apps that no rule covers yet, skipping dismissed ones. Keeps the order
/// of `seen` (callers sort it by usage).
pub fn suggestions(
    seen: &[SeenApp],
    rules: &[ActivityRule],
    dismissed: &[String],
) -> Vec<Suggestion> {
    seen.iter()
        .filter(|app| !has_rule_for(&app.app_id, rules))
        .filter(|app| !dismissed.iter().any(|d| d == &app.app_id))
        .filter_map(|app| {
            let (pack, activity) = suggest(&app.app_id, &app.app_name)?;
            Some(Suggestion {
                app_id: app.app_id.clone(),
                app_name: app.app_name.clone(),
                pack_key: pack.key,
                activity,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segment::ActivityId;

    fn seen(id: &str, name: &str) -> SeenApp {
        SeenApp {
            app_id: id.into(),
            app_name: name.into(),
        }
    }

    fn app_rule(app: &str) -> ActivityRule {
        ActivityRule {
            id: 1,
            activity_id: ActivityId(2),
            kind: RuleKind::App(app.into()),
            priority: 0,
        }
    }

    #[test]
    fn catalog_is_well_formed() {
        let mut keys = std::collections::HashSet::new();
        assert!(PRESETS.len() >= 4, "a generic pack plus role examples");
        assert_eq!(PRESETS[0].key, "general");
        for pack in PRESETS {
            assert!(!pack.name.is_empty() && !pack.description.is_empty());
            for a in pack.activities {
                assert!(
                    a.key.starts_with(&format!("{}.", pack.key)),
                    "{} outside {}",
                    a.key,
                    pack.key
                );
                assert!(keys.insert(a.key), "duplicate key {}", a.key);
                assert!(a.color.starts_with('#') && a.color.len() == 7);
                for token in a.hints.name_tokens {
                    assert_eq!(*token, token.to_lowercase());
                }
                for id in a.hints.windows.iter().chain(a.hints.linux) {
                    assert_eq!(*id, id.to_lowercase(), "{id} must be lowercase");
                }
            }
        }
    }

    #[test]
    fn every_platform_scheme_matches_by_exact_id() {
        let (pack, a) = suggest("com.microsoft.VSCode", "Code").unwrap();
        assert_eq!((pack.key, a.key), ("development", "development.coding"));
        assert_eq!(
            suggest("code.exe", "Visual Studio Code").unwrap().1.key,
            a.key
        );
        assert_eq!(suggest("code", "Code").unwrap().1.key, a.key);
        // Case does not matter (Linux ids are lowercased by the adapter).
        assert_eq!(suggest("COM.MICROSOFT.VSCODE", "x").unwrap().1.key, a.key);
    }

    #[test]
    fn browsers_suggest_a_neutral_browsing_activity() {
        for id in [
            "com.google.Chrome",
            "firefox.exe",
            "org.mozilla.firefox",
            "google-chrome",
        ] {
            let (pack, a) = suggest(id, "Browser").unwrap();
            assert_eq!((pack.key, a.name), ("general", "Browsing"), "{id}");
            assert_eq!(a.productivity, Productivity::Neutral);
        }
    }

    #[test]
    fn name_tokens_match_whole_words_only() {
        // Unknown id, known name token.
        let (_, a) = suggest("com.example.app", "Figma").unwrap();
        assert_eq!(a.key, "design.tools");
        // A token inside a longer word does not match ("barcode" is not "code" nor "vscode").
        assert!(suggest("com.example.barcode", "Barcode Scanner").is_none());
        // The id is tokenised too.
        assert_eq!(
            suggest("com.figma.Beta", "Beta").unwrap().1.key,
            "design.tools"
        );
    }

    #[test]
    fn exact_id_beats_name_tokens() {
        // The name says Slack (communication) but the id is a browser's.
        let (_, a) = suggest("com.google.Chrome", "Slack in a window").unwrap();
        assert_eq!(a.key, "general.browsing");
    }

    #[test]
    fn no_match_gives_no_suggestion() {
        assert!(suggest("com.unknown.tool", "Mystery").is_none());
    }

    #[test]
    fn pack_matching_is_limited_to_the_pack() {
        let design = preset("design").unwrap();
        assert_eq!(
            match_in_pack(design, "com.figma.Desktop", "Figma")
                .unwrap()
                .key,
            "design.tools"
        );
        assert!(match_in_pack(design, "com.microsoft.VSCode", "Code").is_none());
        assert!(preset("nope").is_none());
    }

    #[test]
    fn suggestions_skip_covered_and_dismissed_apps() {
        let apps = vec![
            seen("com.figma.Desktop", "Figma"),
            seen("com.microsoft.VSCode", "Code"),
            seen("com.google.Chrome", "Chrome"),
            seen("com.unknown.tool", "Mystery"),
        ];
        let rules = vec![app_rule("com.microsoft.VSCode")];
        let dismissed = vec!["com.google.Chrome".to_owned()];
        let out = suggestions(&apps, &rules, &dismissed);
        let ids: Vec<_> = out.iter().map(|s| s.app_id.as_str()).collect();
        assert_eq!(
            ids,
            ["com.figma.Desktop"],
            "covered, dismissed and unknown are skipped"
        );
        assert_eq!(out[0].activity.name, "Design tools");

        // A dismissed suggestion never comes back, however often it is asked for.
        assert!(
            suggestions(&apps, &[], &["com.figma.Desktop".to_owned()])
                .iter()
                .all(|s| s.app_id != "com.figma.Desktop")
        );
    }

    #[test]
    fn a_title_rule_scoped_to_the_app_counts_as_covered() {
        let scoped = ActivityRule::title_pattern(
            3,
            ActivityId(2),
            "^Inbox",
            Some("com.apple.mail".into()),
            0,
        )
        .unwrap();
        let unscoped = ActivityRule::title_pattern(4, ActivityId(2), "x", None, 0).unwrap();
        assert!(has_rule_for("com.apple.mail", &[scoped]));
        assert!(!has_rule_for("com.apple.mail", &[unscoped]));
    }
}
