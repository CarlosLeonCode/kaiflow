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
    body: "Idle detection, appearance, startup behavior and the global shortcut live here, along with your data: a daily backup of your tracked time and a way to restore it from a file.",
  },
};
