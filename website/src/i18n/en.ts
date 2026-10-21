import type { Content } from "./types";

export const en: Content = {
  meta: {
    title: "TimeTrack: see where your day actually goes",
    description:
      "A private, local-first menu bar time tracker for macOS, with Windows and Linux coming soon. Automatic tracking by app and window, goals, focus sessions and a weekly review. Free, open source (MIT) and easy to fork and customize with AI coding agents.",
    ogAlt: "TimeTrack: a private time tracker that lives in your menu bar.",
  },
  a11y: {
    skip: "Skip to content",
    primaryNav: "Primary",
    languageNav: "Language",
    home: "TimeTrack home",
    opensNewTab: "opens on GitHub",
    yes: "Supported",
    partial: "Partly supported",
    no: "Not supported",
  },
  nav: { features: "Features", privacy: "Privacy", platforms: "Platforms", install: "Install", faq: "FAQ", download: "Download" },
  language: { label: "Language", en: "English", es: "Español" },
  hero: {
    eyebrow: "Free and open source · Private by design",
    title: "See where your day actually goes.",
    lead:
      "TimeTrack quietly records which app and window you are using, then shows your day as a clear timeline. No timers to start, no account to create, and nothing leaves your computer.",
    primary: "Download for macOS",
    secondaryLabel: "Coming soon:",
    secondary: [
      { label: "Windows", href: "#platforms" },
      { label: "Linux", href: "#platforms" },
    ],
    note: "Requires macOS 13 or later. Universal build for Apple silicon and Intel.",
    notice: "Free. Not notarized by Apple — the first time, open it from System Settings → Privacy & Security.",
    noticeLink: "See the install steps",
    shotAlt:
      "The TimeTrack Today view: 4 hours 25 minutes of focused time, a colored timeline from 9 AM to 2 PM, and totals by app and by activity.",
    popoverAlt:
      "The TimeTrack menu bar popover showing today's total, the app in use right now and the top apps of the day.",
  },
  how: {
    title: "Set it up once. Then forget about it.",
    lead: "There is no timer to remember. TimeTrack works in the background from the menu bar.",
    steps: [
      {
        title: "Install and allow window titles",
        body: "Open the app and grant Accessibility once, so it can read the title of the window in front. Skip it and TimeTrack still records app names.",
      },
      {
        title: "Work as usual",
        body: "Every app and window you use is recorded automatically. Step away and idle time is detected, so breaks never inflate your numbers.",
      },
      {
        title: "Review and adjust",
        body: "Open the dashboard to see your timeline, group time into activities and set goals. A glance at the menu bar shows today's total.",
      },
    ],
  },
  features: {
    title: "Everything you need to understand your time",
    lead: "Simple on the surface, with enough depth to answer real questions about your week.",
    items: [
      {
        title: "Automatic tracking",
        body: "Records only the app in front and its window title. No manual timers, no screenshots, no keystrokes.",
      },
      {
        title: "Activities and rules",
        body: "Group time into projects, clients or tasks with rules by app or window title. Mark each one productive, neutral or distracting.",
      },
      {
        title: "Overview dashboard",
        body: "Distribution by activity, top window titles, trends over time, an hour by weekday heatmap and your focus percentage.",
      },
      {
        title: "Goals with streaks",
        body: "Daily, weekly or monthly targets, as a minimum to reach or a limit to stay under. Streaks keep you honest, and goals never block anything.",
      },
      {
        title: "Focus sessions",
        body: "Set an intent and the apps that belong to it. A countdown sits in the menu bar and a gentle alert appears if you drift.",
      },
      {
        title: "Weekly review",
        body: "A calm summary of the week: what went well, where time slipped, and how your goals did. Optional AI insights, only if you ask.",
      },
      {
        title: "Idle detection",
        body: "When you come back, choose to discard the time away or assign it to an activity, such as a meeting or a phone call.",
      },
      {
        title: "Export and backups",
        body: "Export your history as JSON at any time. A daily backup is kept on your machine and can be restored in one step.",
      },
    ],
  },
  showcase: {
    title: "A clear picture, in light or dark",
    lead: "Native-feeling windows that follow your system appearance.",
    shots: [
      {
        key: "overview",
        title: "Overview",
        body: "Your week by day, your busiest hours and how much of your time was focused.",
        alt: "The Overview dashboard for a week: 15 hours 57 minutes in total, a focus ratio, stacked bars by day and a heatmap of the busiest hours.",
      },
      {
        key: "goals",
        title: "Goals",
        body: "Targets to reach and limits to respect, with progress and streaks.",
        alt: "The Goals view with four goals: deep work in progress, a Slack limit passed by 5 minutes, a daily goal reached with a 46-day streak, and a weekly target.",
      },
      {
        key: "focus",
        title: "Focus",
        body: "A timed block for one intent, with the apps that belong to it.",
        alt: "A running focus session titled Write report with 40 minutes left, a progress bar and buttons to add 10 minutes or end the session.",
      },
    ],
  },
  personas: {
    title: "Made for any kind of work",
    lead: "If your work happens on a computer, TimeTrack helps you see it clearly.",
    items: [
      {
        role: "Marketers",
        summary: "Balance campaign work with the constant pull of messages.",
        examples: [
          "See how long the launch deck really took in Keynote or Figma",
          "Set a limit of 45 minutes a day in social media tools",
          "Spot the afternoons lost to back-to-back calls",
        ],
      },
      {
        role: "Accountants and consultants",
        summary: "Turn a busy day into accurate hours per client.",
        examples: [
          "A rule sends every spreadsheet with a client's name to that client",
          "Weekly totals per client, ready for your timesheet",
          "Export to JSON when it is time to invoice",
        ],
      },
      {
        role: "Designers and creatives",
        summary: "Protect the long stretches where the real work happens.",
        examples: [
          "A focus session with only your design tools allowed",
          "A goal of three hours of deep work every weekday",
          "A heatmap that shows when you do your best work",
        ],
      },
      {
        role: "Students and researchers",
        summary: "Know how much studying actually happened this week.",
        examples: [
          "Separate reading, writing and browsing by window title",
          "A streak for at least two hours of study a day",
          "A weekly review before planning the next one",
        ],
      },
    ],
  },
  privacy: {
    title: "Your time is yours. So is the data.",
    lead: "TimeTrack is built so that the safest behavior is the default. There is no account, no cloud and no tracking of you.",
    readTitle: "What it reads",
    read: [
      "The name of the app in front",
      "The title of the window in front, with your permission",
      "Whether you are idle, locked or asleep",
    ],
    neverTitle: "What it never reads",
    never: [
      "Your screen: Screen Recording is never requested",
      "Keystrokes, clipboard or the content of your files",
      "Web pages, messages or anything in the background",
    ],
    storageTitle: "Where it is stored",
    storage: [
      "A local database on your computer, nowhere else",
      "Exclude apps, hide titles or delete any range of time",
      "Export or delete everything whenever you want",
    ],
  },
  ai: {
    eyebrow: "Optional",
    title: "An AI weekly review, only if you want one",
    lead:
      "The weekly review works fully offline. If you would like a second opinion, you can turn on an AI analysis of your week with the provider you choose.",
    points: [
      {
        title: "Off until you turn it on",
        body: "Nothing is sent unless you enable a provider and run the analysis yourself.",
      },
      {
        title: "Aggregated data by default",
        body: "By default it shares summaries of your week rather than your raw history.",
      },
      {
        title: "Preview before sending",
        body: "See exactly what will be shared before it leaves your machine.",
      },
      {
        title: "Keys in your keychain",
        body: "API keys are stored in your operating system's secure keychain, never in plain files.",
      },
    ],
    providersTitle: "Works with",
    providers: ["Claude", "Gemini", "OpenAI", "Ollama (runs locally)"],
  },
  platforms: {
    title: "Platform support",
    lead: "Released for macOS. Windows and Linux are implemented and tracking already; ready-made downloads are coming soon.",
    feature: "Capability",
    columns: ["macOS", "Windows", "Linux (X11)", "Linux (Wayland)"],
    rows: [
      {
        label: "App in front",
        cells: [["yes", ""], ["yes", ""], ["yes", ""], ["no", ""]],
      },
      {
        label: "Window titles",
        cells: [["yes", "With Accessibility permission"], ["yes", "No permission needed"], ["yes", "No permission needed"], ["no", ""]],
      },
      {
        label: "Idle detection",
        cells: [["yes", ""], ["yes", ""], ["yes", ""], ["partial", "GNOME or logind"]],
      },
      {
        label: "Lock and sleep",
        cells: [["yes", ""], ["yes", ""], ["yes", ""], ["yes", ""]],
      },
      {
        label: "Text in the menu bar or tray",
        cells: [["yes", "Menu bar"], ["partial", "Tooltip only"], ["partial", "AppIndicator label"], ["partial", "AppIndicator label"]],
      },
      {
        label: "Ready-made download",
        cells: [["yes", "DMG on GitHub Releases"], ["partial", "Coming soon. Build from source for now"], ["partial", "Coming soon. Build from source for now"], ["partial", "Coming soon. Build from source for now"]],
      },
    ],
    note: "Wayland does not let apps see which window is in front, so only idle, lock and sleep are recorded there. Log in to an X11 session (for example GNOME on Xorg) for full tracking.",
    sourceLink: "Build for Windows or Linux",
  },
  faq: {
    title: "Questions and answers",
    items: [
      {
        q: "Why does TimeTrack ask for Accessibility permission?",
        a: "On macOS, Accessibility is how an app reads the title of the window in front, which lets TimeTrack tell one document or website from another. It is only used for that. Without it, TimeTrack still records app names. It never asks for Screen Recording.",
      },
      {
        q: "Does it work on Linux with Wayland?",
        a: "Partly. Wayland does not allow an app to see which window another app has in front, so on Wayland TimeTrack can record idle, lock and sleep, but not apps or titles. Choose an X11 session at login for full tracking.",
      },
      {
        q: "Where is my data stored?",
        a: "In a local database on your computer. On macOS it lives in ~/Library/Application Support/com.carlosleon.timetrack/. You can export it as JSON, restore a daily backup, or delete any range at any time.",
      },
      {
        q: "Does anything leave my computer?",
        a: "Only two things, and both are under your control: the check for app updates, and the optional AI weekly review if you turn it on and run it. Everything else stays on your machine.",
      },
      {
        q: "Why does macOS warn me when I open it?",
        a: "TimeTrack is free and not notarized by Apple, which requires a paid developer account. macOS shows that warning for any app it has not checked. The source is public, and the first time you open it from System Settings → Privacy & Security (or with right-click → Open on macOS 14 and earlier) macOS remembers your choice.",
      },
      {
        q: "Is it free?",
        a: "Yes. TimeTrack is free and open source under the MIT license. There is no account, no subscription and no paid tier.",
      },
      {
        q: "Can I use it for commercial work?",
        a: "Yes. The MIT license lets you use, modify and redistribute it, including for commercial work and in your own products, as long as you keep the copyright and license notice.",
      },
      {
        q: "Will it slow down my computer?",
        a: "No. It checks the window in front every couple of seconds and reacts to app switches as they happen, which takes very little energy.",
      },
    ],
  },
  install: {
    title: "Install on macOS",
    lead: "It takes a minute. The first open needs one extra step because the app is free and not notarized by Apple.",
    steps: [
      {
        title: "Download",
        body: "Get the latest .dmg from GitHub Releases. It is a universal build for Apple silicon and Intel.",
      },
      {
        title: "Move it to Applications",
        body: "Open the .dmg and drag TimeTrack to the Applications folder.",
      },
      {
        title: "Open it the first time",
        body: "macOS says it cannot verify the developer. Click Done, then follow the steps for your macOS version below.",
      },
    ],
    firstOpenTitle: "First open",
    firstOpenLead: "You only need to do this once. After that, TimeTrack opens like any other app.",
    variants: [
      {
        title: "macOS 15 Sequoia or later",
        steps: [
          "Try to open TimeTrack from Applications, then click Done in the warning.",
          "Open System Settings → Privacy & Security.",
          "Scroll down to Security and click Open Anyway next to the message about TimeTrack.",
          "Click Open Anyway again and enter your password.",
        ],
      },
      {
        title: "macOS 13 Ventura and 14 Sonoma",
        steps: [
          "In Finder, open the Applications folder.",
          "Right-click (or Control-click) TimeTrack and choose Open.",
          "Click Open in the dialog.",
        ],
      },
    ],
    advancedTitle: "Advanced: use Terminal instead",
    advancedBody: "Only if you trust the download. This removes the quarantine flag, which skips the Gatekeeper check for this app:",
    permissionTitle: "Then allow window titles",
    permissionBody: "When TimeTrack asks, turn it on in System Settings → Privacy & Security → Accessibility. Without it, TimeTrack still records app names.",
  },
  availability: {
    title: "Availability",
    available: "Available",
    soon: "Coming soon",
    items: [
      { name: "macOS", status: "available", detail: "Universal DMG for macOS 13 or later" },
      { name: "Windows", status: "soon", detail: "Implemented. Build from source today" },
      { name: "Linux", status: "soon", detail: "Implemented for X11. Build from source today" },
    ],
    watch: "Watch releases",
    vote: "Ask for your platform",
  },
  fork: {
    eyebrow: "Open source · MIT",
    title: "Make it yours",
    lead: "TimeTrack is built to be forked. Change it by hand, or let an AI coding agent do the work: the project ships with a guide written for agents.",
    points: [
      {
        title: "A clean base to build on",
        body: "A pure domain, explicit ports and one adapter per operating system, so changes stay small, local and testable.",
      },
      {
        title: "Instructions for AI agents",
        body: "AGENTS.md maps the architecture, the rules to respect and the exact commands to verify a change.",
      },
      {
        title: "Rebrand in an afternoon",
        body: "The forking guide lists every name, icon and key to change, with ideas and example prompts.",
      },
    ],
    agentsTitle: "Works well with",
    agents: ["Claude Code", "Antigravity", "Cursor", "Codex", "GitHub Copilot"],
    promptTitle: "Example prompt",
    prompt: "Read AGENTS.md. Add a CSV export of totals per activity for a date range, following the end-to-end recipe, and run every verification command.",
    agentsLink: "Read AGENTS.md",
    forkingLink: "Forking guide",
    forkLink: "Fork on GitHub",
  },
  support: {
    title: "Support the project",
    lead: "TimeTrack is free and will stay that way. If it helps you, a star makes it easier for others to find it.",
    star: "Star on GitHub",
    sponsor: "Sponsor on GitHub",
  },
  cta: {
    title: "Start seeing your day clearly.",
    lead: "Free, private and ready in a minute.",
    primary: "Download for macOS",
    secondary: "View the source on GitHub",
  },
  footer: {
    tagline: "A private time tracker for your menu bar.",
    license: "MIT licensed",
    source: "Source code",
    releases: "Releases",
    issues: "Report an issue",
  },
};
