import { useT } from "@/shared/i18n";
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
  const words = useT().settings.diagnostics;
  const reads = diagnostics?.title_reads.slice(0, MAX_APPS_SHOWN) ?? [];
  return (
    <Panel
      title={words.title}
      description={words.description}
    >
      <dl className="divide-y divide-border">
        {diagnostics?.accessibility_trusted != null && (
          <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
            <dt className="font-medium">{words.trusted}</dt>
            <dd className="text-right text-xs text-muted-foreground">
              {diagnostics.accessibility_trusted ? words.yes : words.no}
            </dd>
          </div>
        )}
        <div className="px-3 py-2.5">
          <dt className="font-medium">{words.lastRead}</dt>
          <dd className="mt-1 text-xs text-muted-foreground">
            {reads.length === 0 ? (
              <span>{words.noReads}</span>
            ) : (
              <ul className="space-y-1" aria-label={words.perApp}>
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
        label={words.copy}
        description={
          error ? error : copyState === "copied" ? words.copied : copyState === "failed" ? words.copyFailed : words.copyHint
        }
        controlId="setting-diagnostics-copy"
      >
        <div className="flex gap-2">
          <Button
            variant="ghost"
            aria-label={words.refreshLabel}
            onClick={onRefresh}
          >
            {words.refresh}
          </Button>
          <Button
            id="setting-diagnostics-copy"
            disabled={!diagnostics}
            onClick={onCopy}
          >
            {words.copy}
          </Button>
        </div>
      </Row>
    </Panel>
  );
}
