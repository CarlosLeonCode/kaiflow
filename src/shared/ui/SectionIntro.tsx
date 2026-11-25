import { ArrowRight, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { useT } from "@/shared/i18n";

import { Button } from "./button";

/** One "this goes in, that comes out" pair of the optional mini diagram. */
export interface IntroExampleRow {
  /** What the computer sees, e.g. an app and a window title. */
  from: string;
  /** What it becomes, e.g. an activity name. */
  to: string;
}

export interface IntroContent {
  title: string;
  /** What this is (one short line). */
  what: string;
  /** What you can do here (one short line). */
  can: string;
  /** A concrete, role-agnostic example (one short line). */
  example: string;
  /** Optional mini diagram shown under the example. */
  diagram?: readonly IntroExampleRow[];
}

interface Props {
  id: string;
  content: IntroContent;
  /** Bumped by the help button: moves keyboard focus to the intro. */
  focusRequest: number;
  onDismiss: () => void;
}

const LINES = ["what", "can", "example"] as const;

/**
 * A short explanation at the top of a section with the same three lines everywhere: what this
 * is, what you can do here and an example. A paper card like the Progress panel, with small
 * muted labels beside each line. Dismissible; the header's help button reopens it.
 */
export function SectionIntro({ id, content, focusRequest, onDismiss }: Props) {
  const t = useT();
  const labels = t.ui.sectionIntro;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusRequest > 0) ref.current?.focus();
  }, [focusRequest]);

  return (
    <aside
      id={id}
      ref={ref}
      tabIndex={-1}
      aria-label={t.ui.about(content.title)}
      className="relative mb-5 rounded-card bg-paper-surface px-5 pt-4 pb-5 text-foreground focus-visible:outline-offset-0"
    >
      <h2 className="pr-9 font-display text-lg leading-[1.2] font-bold tracking-[-0.01em]">{content.title}</h2>
      <dl className="mt-3 grid items-baseline gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_minmax(0,1fr)]">
        {LINES.map((line) => (
          <div key={line} className="contents">
            <dt className="font-display text-xs font-bold text-muted-foreground">{labels[line]}</dt>
            <dd className="m-0 mb-1 sm:mb-0">
              {content[line]}
              {line === "example" && content.diagram && content.diagram.length > 0 && (
                <ul aria-label={labels.diagram} className="mt-2 flex flex-wrap gap-2">
                  {content.diagram.map((row) => (
                    <li
                      key={`${row.from}-${row.to}`}
                      className="flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pr-0.5 pl-3 text-xs"
                    >
                      <span className="text-muted-foreground">{row.from}</span>
                      <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="sr-only">{labels.becomes}</span>
                      <span className="rounded-full border-[1.5px] border-mark-stroke bg-pop-sun px-2 py-px font-display font-bold text-on-pop">
                        {row.to}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-3 right-3 hover:bg-mark-stroke/10"
        aria-label={labels.dismiss(content.title)}
        onClick={onDismiss}
      >
        <X />
      </Button>
    </aside>
  );
}
