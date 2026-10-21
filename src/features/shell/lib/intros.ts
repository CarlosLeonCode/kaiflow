import type { SectionId } from "./sections";

export interface IntroCopy {
  title: string;
  body: string;
}

/** Role-agnostic explanations, one per dashboard section. Dismissals persist by section id. */
export const INTROS: Record<SectionId, IntroCopy> = {
  today: {
    title: "Your day at a glance",
    body: "A timeline of what you used today, with totals by activity and by app. Tracking runs in the background; pause or resume it from the menu bar.",
  },
  overview: {
    title: "See the bigger picture",
    body: "Pick a day, a week, a month or the last 90 days to see where your time went: totals by activity and app, a trend against the period before, the hours you are busiest and how much of your time was productive. Time that crosses midnight is shared between both days.",
  },
  goals: {
    title: "Aim for what matters",
    body: "A goal is a target for your time: at least some hours of an activity, or at most some minutes in an app. Pick a period and the days that count, and you will see your progress and a streak of periods in a row. Rest days never break a streak. Goals only keep you informed: nothing is ever blocked.",
  },
  focus: {
    title: "Work in focused blocks",
    body: "Start a session with what you want to get done, how long it should last and which activities or apps belong to it. If you spend a while somewhere else, you get a gentle nudge: no sound, nothing is blocked. When the time is up you see how much of it stayed on target.",
  },
  review: {
    title: "Look back on your week",
    body: "Every week gets a summary built on this computer: where your time went, when you were busiest, how your goals went and your focus sessions, plus a place for your own notes. Optionally, you can ask an AI model for a written analysis. That is off until you switch a provider on in Settings, and you always see exactly what would be sent before anything leaves your computer. Window titles are never included unless you choose so.",
  },
  activities: {
    title: "Organize time into activities",
    body: "An activity is a label for what you were doing: a project, a client or a kind of task. Rules say which apps and window titles belong to each one, so your time is sorted for you, past time included. Anything without a rule stays Unassigned.",
  },
  privacy: {
    title: "You decide what is stored",
    body: "Choose whether window titles are saved, keep specific apps out of your records and delete tracked data. Everything stays on this computer.",
  },
  settings: {
    title: "Tune the app",
    body: "Idle detection, appearance, the first day of your week, startup behavior and the global shortcut live here, along with your data (a daily backup of your tracked time and a way to restore it from a file) and the optional AI analysis, which stays off until you switch a provider on.",
  },
};
