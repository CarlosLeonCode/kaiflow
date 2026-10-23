import type { DiagnosticsDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";
import { Panel, Row } from "@/shared/ui/field";

interface Props {
  /** `undefined` while loading. */
  diagnostics: DiagnosticsDto | undefined;
  /** Feedback after "Copy diagnostics": `copied`, `failed` or nothing yet. */
  copyState: "idle" | "copied" | "failed";
  /** Load failure; shown as plain text (diagnostics are secondary, not an alert). */
  error: string | null;
  onCopy: () => void;
  onRefresh: () => void;
}

const MAX_APPS_SHOWN = 6;

function trustedLabel(trusted: boolean): string {
  return trusted ? "Yes" : "No";
}

/**
 * Settings panel (presentational): whether window titles can be read and why not. Shows
 * bundle ids and status codes only, never window titles.
 */
export function DiagnosticsPanel({
  diagnostics,
  copyState,
  error,
  onCopy,
  onRefresh,
}: Props) {
  const reads = diagnostics?.title_reads.slice(0, MAX_APPS_SHOWN) ?? [];
  return (
    <Panel
      title="Diagnostics"
      description="Local only. Shows app ids and status codes, never window titles."
    >
      <dl className="divide-y divide-border">
        {diagnostics?.accessibility_trusted != null && (
          <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
            <dt className="font-medium">Accessibility trusted</dt>
            <dd className="text-right text-xs text-muted-foreground">
              {trustedLabel(diagnostics.accessibility_trusted)}
            </dd>
          </div>
        )}
        <div className="px-3 py-2.5">
          <dt className="font-medium">Last title read</dt>
          <dd className="mt-1 text-xs text-muted-foreground">
            {reads.length === 0 ? (
              <span>No reads yet.</span>
            ) : (
              <ul className="space-y-1" aria-label="Last title read per app">
                {reads.map((read) => (
                  <li
                    key={read.app_id}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span data-selectable className="min-w-0 truncate">
                      {read.app_id}
                    </span>
                    <span
                      data-selectable
                      className={
                        read.ok
                          ? "shrink-0"
                          : "shrink-0 font-medium text-foreground"
                      }
                    >
                      {read.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <Row
        label="Copy diagnostics"
        description={
          error
            ? error
            : copyState === "copied"
              ? "Copied to the clipboard."
              : copyState === "failed"
                ? "Could not copy to the clipboard."
                : "Status plus the local diagnostics log, to paste into a bug report."
        }
        controlId="setting-diagnostics-copy"
      >
        <div className="flex gap-2">
          <Button
            variant="ghost"
            aria-label="Refresh diagnostics"
            onClick={onRefresh}
          >
            Refresh
          </Button>
          <Button
            id="setting-diagnostics-copy"
            disabled={!diagnostics}
            onClick={onCopy}
          >
            Copy diagnostics
          </Button>
        </div>
      </Row>
    </Panel>
  );
}
