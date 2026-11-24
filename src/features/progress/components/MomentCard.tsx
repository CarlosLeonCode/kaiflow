import { X } from "lucide-react";
import { useId, type ReactNode } from "react";

import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

import { POP_BG, type PopTone } from "../lib/progress";

interface Props {
  /** `sun` for a finished day, `pink` for a new seal, `sky` for a new level. */
  tone: PopTone;
  /** A 64px `DailyEnso` (with `onPop`), a `Seal` or a `Kai` (with `frame="none"`). */
  drawing: ReactNode;
  title: string;
  /** One warm, short sentence. */
  sentence: string;
  /** The way to the detail ("See your seals"). */
  link: { label: string; onClick: () => void };
  onDismiss: () => void;
  /** Pop in once (only without reduced motion). */
  animate?: boolean;
  className?: string;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring";

/** The one place a reward is announced: a bright sticker card that pops in once. */
export function MomentCard({ tone, drawing, title, sentence, link, onDismiss, animate = true, className }: Props) {
  const t = useT();
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-tone={tone}
      className={cn(
        "relative grid grid-cols-[auto_1fr] items-center gap-4 rounded-card border-2 border-mark-stroke p-5 text-on-pop shadow-(--shadow-sticker)",
        POP_BG[tone],
        animate && "motion-safe:animate-kf-pop",
        className,
      )}
    >
      <div className="shrink-0">{drawing}</div>
      <div className="min-w-0 pr-6">
        <h3 id={titleId} className="m-0 font-display text-[18px] leading-[1.2] font-bold tracking-[-0.01em]">
          {title}
        </h3>
        <p className="mt-1 mb-2 text-sm text-on-pop-muted">{sentence}</p>
        <button
          type="button"
          onClick={link.onClick}
          className={cn(
            "rounded-sm font-display text-sm font-bold text-on-pop underline decoration-2 underline-offset-[3px]",
            FOCUS,
          )}
        >
          {link.label}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t.progress.moment.dismiss(title)}
        className={cn(
          "absolute top-3 right-3 grid size-7 place-items-center rounded-full text-on-pop hover:bg-on-pop-track",
          FOCUS,
        )}
      >
        <X className="size-4" strokeWidth={2.4} aria-hidden="true" />
      </button>
    </section>
  );
}
