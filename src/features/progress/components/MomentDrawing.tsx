import type { MomentDto, SealViewDto } from "@/shared/ipc";
import { useT } from "@/shared/i18n";

import { FAMILY_TONE, SEAL_GLYPH } from "../lib/progress";
import { DailyEnso } from "./DailyEnso";
import { Seal } from "./Seal";

/** The fresh ensō of a new level: the first stroke of the next stretch of the path. */
const FRESH_ENSO = 0.08;

interface Props {
  moment: MomentDto;
  /** Every seal, to color a new one by its family. */
  seals: readonly SealViewDto[];
}

/**
 * The drawing of a moment card: the full ensō for a finished day, the seal itself for a new
 * seal, and a fresh ensō for a level. Never Kai: the popover already has its Kai badge, and
 * there is at most one Kai per screen.
 */
export function MomentDrawing({ moment, seals }: Props) {
  const t = useT();
  switch (moment.kind) {
    case "day_done":
      // The card's title already says it ("Today's ensō is done").
      return <DailyEnso progress={1} size={64} label="" onPop animate />;
    case "seal": {
      const family = seals.find((seal) => seal.id === moment.seal)?.family ?? "focus";
      return (
        <Seal
          glyph={SEAL_GLYPH[moment.seal]}
          tone={FAMILY_TONE[family]}
          state="earned"
          label={t.progress.seals.names[moment.seal]}
          size={60}
        />
      );
    }
    case "level":
      return <DailyEnso progress={FRESH_ENSO} size={64} label={t.progress.moment.level.drawing} onPop animate />;
  }
}
