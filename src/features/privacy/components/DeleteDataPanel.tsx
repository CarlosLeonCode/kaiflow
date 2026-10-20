import { useId, useState } from "react";

import type { DeleteOpDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { parseDays, rangeFromDays, toDateInput } from "../lib/delete";

interface Props {
  /** Local "today", the default end of the date range. */
  today: number;
  /** Starts a destructive operation (asks the backend for a confirm token, then the dialog opens). */
  onRequest: (op: DeleteOpDto) => void;
  busy: boolean;
}

function Block({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-3">
      <h3 className="font-medium">{title}</h3>
      <p className="mb-2 text-xs text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}

/**
 * The three ways to delete data (R10.4). Each only requests the operation; the confirmation
 * dialog and the backend's single-use token do the actual guarding.
 */
export function DeleteDataPanel({ today, onRequest, busy }: Props) {
  const id = useId();
  const [from, setFrom] = useState(() => toDateInput(today));
  const [to, setTo] = useState(() => toDateInput(today));
  const [days, setDays] = useState("30");
  const [touched, setTouched] = useState<"range" | "days" | null>(null);

  const range = rangeFromDays(from, to);
  const parsed = parseDays(days);
  const rangeError = touched === "range" && !range ? "Choose a start date that is not after the end date." : null;
  const daysError = touched === "days" && "problem" in parsed ? "Enter a whole number of days, 1 or more." : null;

  return (
    <section aria-label="Delete data" className="space-y-2">
      <div className="px-1">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-destructive">Delete data</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Deleting is permanent. You will be asked to confirm before anything is removed.
        </p>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        <Block title="Delete a date range" description="Removes everything recorded between two days, both included.">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`${id}-from`} className="mb-1 block text-xs font-medium text-muted-foreground">
                From
              </label>
              <Input
                id={`${id}-from`}
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                aria-invalid={rangeError ? true : undefined}
              />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className="mb-1 block text-xs font-medium text-muted-foreground">
                To
              </label>
              <Input
                id={`${id}-to`}
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                aria-invalid={rangeError ? true : undefined}
              />
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                setTouched("range");
                if (range) onRequest({ kind: "range", range });
              }}
            >
              Delete range…
            </Button>
          </div>
          {rangeError && (
            <p role="alert" className="mt-1.5 text-xs text-destructive">
              {rangeError}
            </p>
          )}
        </Block>

        <Block
          title="Delete older data"
          description="Removes everything recorded more than a number of days ago and keeps the rest."
        >
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`${id}-days`} className="mb-1 block text-xs font-medium text-muted-foreground">
                Older than (days)
              </label>
              <Input
                id={`${id}-days`}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                aria-invalid={daysError ? true : undefined}
                aria-describedby={daysError ? `${id}-days-error` : undefined}
                className="tabular w-24"
              />
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                setTouched("days");
                if ("days" in parsed) onRequest({ kind: "older_than_days", days: parsed.days });
              }}
            >
              Delete older data…
            </Button>
          </div>
          {daysError && (
            <p id={`${id}-days-error`} role="alert" className="mt-1.5 text-xs text-destructive">
              {daysError}
            </p>
          )}
        </Block>

        <Block title="Delete everything" description="Removes all tracked time and history. Your settings, categories and rules stay.">
          <Button
            disabled={busy}
            onClick={() => onRequest({ kind: "all" })}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Delete all data…
          </Button>
        </Block>
      </div>
    </section>
  );
}
