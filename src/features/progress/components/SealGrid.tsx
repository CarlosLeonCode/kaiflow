import type { SealViewDto } from "@/shared/ipc";
import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

import { FAMILY_TONE, SEAL_GLYPH, SEAL_UNIT } from "../lib/progress";
import { Seal, type SealState } from "./Seal";

interface Props {
  /** Every seal, earned or locked, in the backend's order. */
  seals: readonly SealViewDto[];
  /** Locked seals shown after the earned ones. */
  maxLocked?: number;
  className?: string;
}

function stateOf(seal: SealViewDto): SealState {
  if (!seal.earned) return "locked";
  return seal.seen ? "earned" : "new";
}

/** The seal collection: earned stickers first, then the next few locked ones with a hint. */
export function SealGrid({ seals, maxLocked = 3, className }: Props) {
  const t = useT();
  const shown = [...seals.filter((s) => s.earned), ...seals.filter((s) => !s.earned).slice(0, maxLocked)];
  return (
    <ul
      aria-label={t.progress.seals.label}
      className={cn("m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-3 gap-y-6 p-0", className)}
    >
      {shown.map((seal, i) => {
        const name = t.progress.seals.names[seal.id];
        const state = stateOf(seal);
        const label =
          state === "locked"
            ? t.progress.seals.locked(name)
            : state === "new"
              ? t.progress.seals.new(name)
              : t.progress.seals.earned(name);
        return (
          <li key={seal.id}>
            <Seal
              glyph={SEAL_GLYPH[seal.id]}
              tone={FAMILY_TONE[seal.family]}
              state={state}
              label={label}
              name={name}
              hint={state === "locked" ? t.progress.seals.hint[SEAL_UNIT[seal.id]](seal.current, seal.target) : undefined}
              tilt={i % 2 === 0 ? "left" : "right"}
            />
          </li>
        );
      })}
    </ul>
  );
}
