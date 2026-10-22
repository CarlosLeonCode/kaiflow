import type { OsDto } from "@/shared/ipc";
import { platformWords } from "@/shared/lib/platform";
import type { IntroContent } from "@/shared/ui/SectionIntro";

import type { SectionId } from "./sections";

/**
 * Role-agnostic explanations, one per dashboard section, all with the same three short lines:
 * what this is, what you can do here and a concrete example. Dismissals persist by section id.
 */
export const INTROS: Record<SectionId, IntroContent> = {
  today: {
    title: "Your day so far",
    what: "A timeline of the apps and windows you used today, and for how long.",
    can: "Check today's total, see time per activity and per app, and pause tracking from the menu bar.",
    example: "See that the morning went to email and the afternoon to the quarterly report.",
  },
  overview: {
    title: "The bigger picture",
    what: "Your tracked time over a day, a week, a month or the last 90 days.",
    can: "Switch periods, compare with the period before, and see your busiest hours and focus percentage.",
    example: "Compare this week's time on client work with last week's.",
  },
  goals: {
    title: "Targets for your time",
    what: "Targets that are checked for you as you work. Nothing is ever blocked.",
    can: "Set a minimum for an activity or a limit for an app, per day or week, and build a streak.",
    example: "At least 3 hours of Deep work on weekdays, or at most 30 minutes of social media a day.",
  },
  focus: {
    title: "Focused blocks of time",
    what: "A timed block for one task, with a quiet nudge if you drift somewhere else.",
    can: "Start a session, choose which activities or apps count as on target, and see how it went.",
    example: "45 minutes to finish the budget review, with only the spreadsheet and the docs on target.",
  },
  review: {
    title: "Your week in review",
    what: "A calm summary of your week, built on this computer.",
    can: "See where time went and how goals and focus sessions did, and keep a note. AI analysis is optional and off by default.",
    example: "Notice that meetings took half of Tuesday and plan a quieter one next week.",
  },
  activities: {
    title: "What activities are for",
    what: "Apps tell you where you were. Activities tell you what you were doing, like Deep work or Client A.",
    can: "Add rules that sort your time by app or by words in the window title. Past time is sorted too.",
    example: "The same browser can be research in one tab and a distraction in another:",
    diagram: [
      { from: "Chrome + “YouTube” in the title", to: "Distraction" },
      { from: "VS Code, Excel or Figma", to: "Deep work" },
    ],
  },
  privacy: {
    title: "You decide what is stored",
    what: "Control over what gets recorded. Everything stays on this computer.",
    can: "Stop saving window titles, keep specific apps out of your records, and delete tracked data.",
    example: "Keep your banking app out of your records, or hide the titles of your messaging app.",
  },
  settings: {
    title: "How the app behaves",
    what: "Preferences for tracking, appearance, backups and the optional AI analysis.",
    can: "Adjust idle detection, the theme, the first day of your week, startup, the shortcut and backups.",
    example: "Count 10 minutes away from the keyboard as a break instead of 5.",
  },
};

/** The intro for `section` worded for the OS (the app icon lives in the system tray off macOS). */
export function introFor(section: SectionId, os: OsDto): IntroContent {
  const intro = INTROS[section];
  if (section !== "today" || os === "macos") return intro;
  return {
    ...intro,
    can: `Check today's total, see time per activity and per app, and pause tracking from the ${platformWords(os).tray}.`,
  };
}
