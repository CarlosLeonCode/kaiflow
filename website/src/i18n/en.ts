import { LINKS } from "../lib/links";
import type { Content } from "./types";

export const en: Content = {
  meta: {
    title: "Kaiflow: see where your day actually goes",
    description:
      "A private, local-first menu bar time tracker for macOS, with Windows and Linux in beta. Automatic tracking by app and window, goals, focus sessions and a weekly review. Free, open source (MIT) and easy to fork and customize with AI coding agents.",
    ogAlt: "Kaiflow: improve your focus, one day at a time. A private time tracker that lives in your menu bar.",
  },
  a11y: {
    skip: "Skip to content",
    primaryNav: "Primary",
    languageNav: "Language",
    home: "Kaiflow home",
  },
  nav: { features: "Features", privacy: "Privacy", install: "Install", faq: "FAQ", download: "Download" },
  language: { en: "English", es: "Español" },
  hero: {
    eyebrow: "Free and open source · Private by design",
    title: "See where your day actually goes.",
    lead: "Kaiflow quietly records the app and window in front of you and turns your day into a clear timeline, with no timers, no account and your data on your computer.",
    primary: "Download for macOS",
    secondaryLabel: "Also for",
    secondary: [
      { label: "Windows", href: LINKS.download },
      { label: "Linux", href: LINKS.download },
    ],
    betaBadge: "Beta",
    note: "Requires macOS 13 or later. Universal build for Apple silicon and Intel.",
    notice: "Free. Not notarized by Apple — the first time, open it from System Settings → Privacy & Security.",
    noticeLink: "See the first-open steps",
    videoLabel:
      "A short animated film: your day disappears between apps; Kaiflow shows where it goes, records the app in front of you privately, lets you set a goal and focus, and helps you improve a little every day.",
    pauseVideo: "Pause video",
    playVideo: "Play video",
  },
  features: {
    title: "What you get",
    items: [
      {
        title: "Automatic timeline",
        body: "Every app and window you use, recorded in the background. Nothing to start or stop.",
      },
      {
        title: "Goals and streaks",
        body: "Daily or weekly targets to reach, or limits to stay under, with streaks.",
      },
      {
        title: "Focus timer in the menu bar",
        body: "Set an intent and a countdown. A gentle alert appears if you drift.",
      },
      {
        title: "Weekly review, optional AI",
        body: "A calm summary of your week. Add AI insights only if you ask.",
      },
    ],
    shots: [
      {
        key: "overview",
        alt: "The Overview dashboard for a week: 15 hours 57 minutes in total, a focus ratio, stacked bars by day and a heatmap of the busiest hours.",
      },
      {
        key: "focus",
        alt: "A running focus session titled Write report with 40 minutes left, a progress bar and buttons to add 10 minutes or end the session.",
      },
    ],
  },
  privacy: {
    title: "Your time is yours. So is the data.",
    items: [
      {
        title: "Only the app in front and its title",
        body: "Never your screen, keystrokes, clipboard or files.",
      },
      {
        title: "Stored locally, no account",
        body: "Nothing leaves your computer except the update check and the AI review, if you run it.",
      },
      {
        title: "Open source, MIT",
        body: "Free forever. Read the code, use it for any work.",
      },
    ],
    fork: "Want to change it? Fork it: the repository ships a guide for AI coding agents.",
    forkLink: "Read AGENTS.md",
  },
  download: {
    title: "Download and install",
    lead: "Free, on GitHub Releases. Windows and Linux are beta: they track the same way but have had less testing.",
    available: "Available",
    beta: "Beta",
    platforms: [
      { name: "macOS", status: "available", detail: "Universal DMG for macOS 13 or later", cta: "Download" },
      { name: "Windows", status: "beta", detail: "Installer (.exe) or MSI for Windows 10 and 11", cta: "Download the beta" },
      { name: "Linux", status: "beta", detail: "AppImage or .deb. Full tracking on X11", cta: "Download the beta" },
    ],
    firstOpen: {
      title: "First time opening it?",
      items: [
        {
          title: "macOS",
          steps: [
            "macOS 15 or later: open Kaiflow, click Done, then go to System Settings → Privacy & Security and click Open Anyway.",
            "macOS 13 and 14: in Applications, right-click Kaiflow and choose Open.",
            "Allow Accessibility when asked to record window titles. Without it, app names are still recorded.",
          ],
        },
        {
          title: "Windows",
          steps: [
            "The installer is not code-signed. If SmartScreen appears, click More info → Run anyway.",
            "Kaiflow lives in the system tray, next to the clock.",
          ],
        },
        {
          title: "Linux",
          steps: [
            "Make the AppImage executable and run it, or install the .deb on Ubuntu 22.04, Debian 12 or later.",
            "On GNOME, the tray icon needs the AppIndicator extension.",
          ],
          code: "chmod +x Kaiflow_*.AppImage && ./Kaiflow_*.AppImage\nsudo apt install ./Kaiflow_*.deb",
        },
      ],
    },
  },
  faq: {
    title: "Questions and answers",
    items: [
      {
        q: "Is it free?",
        a: "Yes. Kaiflow is free and open source under the MIT license, including for commercial work. There is no account, no subscription and no paid tier.",
      },
      {
        q: "Why does macOS warn me when I open it?",
        a: "Kaiflow is not notarized by Apple, which requires a paid developer account, so macOS warns about it like any app it has not checked. Open it once from System Settings → Privacy & Security and macOS remembers your choice.",
      },
      {
        q: "Where is my data stored?",
        a: "In a local database on your computer (on macOS, ~/Library/Application Support/com.carlosleon.kaiflow/). Export it as JSON, restore a daily backup or delete any range at any time.",
      },
      {
        q: "Does it work on Linux with Wayland?",
        a: "Partly. Wayland does not let apps see which window is in front, so only idle, lock and sleep are recorded. Choose an X11 session at login for full tracking.",
      },
    ],
  },
  footer: {
    tagline: "Improve your focus, one day at a time.",
    nameNote: "The name blends kaizen, the habit of small continuous improvements, with flow, the state of deep focus.",
    license: "MIT licensed",
    source: "Source code",
    releases: "Releases",
    issues: "Report an issue",
    star: "Star on GitHub",
    sponsor: "Sponsor",
  },
};
