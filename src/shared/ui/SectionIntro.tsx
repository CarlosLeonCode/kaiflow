import { ArrowRight, Info, X } from "lucide-react";
import { useEffect, useRef } from "react";

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

const LINES: readonly { key: "what" | "can" | "example"; label: string }[] = [
  { key: "what", label: "What this is" },
  { key: "can", label: "What you can do here" },
  { key: "example", label: "Example" },
];

/**
 * A short explanation at the top of a section with the same three lines everywhere: what this
 * is, what you can do here and an example. Dismissible; the header's help button reopens it.
 */
export function SectionIntro({ id, content, focusRequest, onDismiss }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusRequest > 0) ref.current?.focus();
  }, [focusRequest]);

  return (
    <aside
      id={id}
      ref={ref}
      tabIndex={-1}
      aria-label={`About ${content.title}`}
      className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 focus-visible:outline-offset-0"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">{content.title}</h2>
        <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
          {LINES.map((line) => (
            <div key={line.key} className="contents">
              <dt className="font-medium text-muted-foreground">{line.label}</dt>
              <dd className="m-0">{content[line.key]}</dd>
            </div>
          ))}
        </dl>
        {content.diagram && content.diagram.length > 0 && (
          <ul aria-label="Example of how time is sorted" className="mt-2 flex flex-wrap gap-2">
            {content.diagram.map((row) => (
              <li
                key={`${row.from}-${row.to}`}
                className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <span className="text-muted-foreground">{row.from}</span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">becomes</span>
                <span className="font-medium">{row.to}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button variant="ghost" size="icon" aria-label={`Dismiss introduction to ${content.title}`} onClick={onDismiss}>
        <X />
      </Button>
    </aside>
  );
}
