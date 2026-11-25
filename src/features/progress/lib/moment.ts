import type { MomentDto } from "@/shared/ipc";
import type { Messages } from "@/shared/i18n";

import { nextLevel, type PopTone } from "./progress";

/** The words and color of a moment card; the drawing is chosen by the caller. */
export interface MomentContent {
  tone: PopTone;
  title: string;
  sentence: string;
  linkLabel: string;
}

/** Title, sentence, link and color for the moment to celebrate, in the active language. */
export function momentContent(moment: MomentDto, t: Messages): MomentContent {
  const copy = t.progress.moment;
  switch (moment.kind) {
    case "day_done":
      return { tone: "sun", title: copy.dayDone.title, sentence: copy.dayDone.body, linkLabel: copy.dayDone.link };
    case "seal":
      return {
        tone: "pink",
        title: copy.seal.title(t.progress.seals.names[moment.seal]),
        sentence: copy.seal.bodies[moment.seal],
        linkLabel: copy.seal.link,
      };
    case "level": {
      const next = nextLevel(moment.name);
      return {
        tone: "sky",
        title: copy.level.title(moment.number, t.progress.levels[moment.name]),
        sentence: next ? copy.level.body(t.progress.levels[next]) : copy.level.top,
        linkLabel: copy.level.link,
      };
    }
  }
}
