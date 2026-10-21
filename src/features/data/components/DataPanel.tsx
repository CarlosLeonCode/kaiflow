import { CircleAlert, X } from "lucide-react";

import type { BackupStatusDto, RestorePreviewDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Panel, Row } from "@/shared/ui/field";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

import { lastBackupLabel, restoreParagraphs } from "../lib/format";

interface Props {
  /** `undefined` while loading. */
  status: BackupStatusDto | undefined;
  now: number;
  /** Something is running: disables the buttons so actions never overlap. */
  busy: boolean;
  backingUp: boolean;
  /** Short confirmation of the last action ("Backup saved to ..."). */
  notice: string | null;
  error: string | null;
  /** File waiting for the user's confirmation (token already issued). */
  preview: RestorePreviewDto | null;
  restoring: boolean;
  restoreError: string | null;
  onToggle: (enabled: boolean) => void;
  onChooseFolder: () => void;
  onUseDefaultFolder: () => void;
  onBackUpNow: () => void;
  onChooseRestoreFile: () => void;
  onConfirmRestore: () => void;
  onCancelRestore: () => void;
  onDismiss: () => void;
}

/** Settings > Data (presentational): the daily backup, its folder and restoring a file. */
export function DataPanel(props: Props) {
  const { status } = props;
  return (
    <>
      <Panel
        title="Data"
        description="Your tracked time can be backed up automatically and restored from a backup or export file. Exports of a date range live in Overview."
      >
        {!status ? (
          <div className="p-3" aria-label="Loading data settings">
            <Skeleton className="h-16" />
          </div>
        ) : (
          <>
            {props.notice && (
              <div className="px-3 py-2.5">
                <Alert variant="neutral" className="items-center justify-between">
                  <span data-selectable className="min-w-0 break-all">
                    {props.notice}
                  </span>
                  <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={props.onDismiss}>
                    <X />
                  </Button>
                </Alert>
              </div>
            )}
            {props.error && (
              <div className="px-3 py-2.5">
                <Alert variant="warning" role="alert">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <AlertDescription>{props.error}</AlertDescription>
                </Alert>
              </div>
            )}

            <Row
              label="Daily backup"
              description="A compressed copy once a day, kept as 7 daily and 4 weekly backups. Made the first time the app runs after midnight."
              controlId="data-backup-enabled"
            >
              <Switch
                id="data-backup-enabled"
                aria-describedby="data-backup-enabled-hint"
                checked={status.enabled}
                onCheckedChange={props.onToggle}
              />
            </Row>

            <Row label="Backup folder" controlId="data-backup-folder" description={status.custom_dir ? "A folder you chose." : "The default folder inside the app data."}>
              <div className="flex items-center gap-2">
                <Button
                  id="data-backup-folder"
                  size="sm"
                  aria-label="Choose folder…"
                  disabled={props.busy}
                  onClick={props.onChooseFolder}
                >
                  Choose folder…
                </Button>
                {status.custom_dir && (
                  <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onUseDefaultFolder}>
                    Use default
                  </Button>
                )}
              </div>
            </Row>
            <p data-selectable data-testid="backup-folder" className="break-all px-3 pb-2.5 text-xs text-muted-foreground">
              {status.dir}
            </p>

            <Row
              label="Last backup"
              description={status.stored === 1 ? "1 backup stored in the folder." : `${status.stored} backups stored in the folder.`}
              controlId="data-backup-now"
            >
              <div className="flex items-center gap-3">
                <span className="tabular text-muted-foreground" data-testid="last-backup">
                  {lastBackupLabel(status.last_backup_at, props.now)}
                </span>
                <Button
                  id="data-backup-now"
                  size="sm"
                  aria-label={props.backingUp ? "Backing up…" : "Back up now"}
                  disabled={props.busy}
                  onClick={props.onBackUpNow}
                >
                  {props.backingUp ? "Backing up…" : "Back up now"}
                </Button>
              </div>
            </Row>
            {status.last_error && (
              <div className="px-3 py-2.5">
                <Alert variant="warning" role="alert">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <AlertDescription>
                    The last backup failed: {status.last_error} Check that the folder exists and can be written to, or
                    choose another folder.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <Row
              label="Restore"
              description="Replace all current data with a backup or export file. You will see what it contains first."
              controlId="data-restore"
            >
              <Button
                id="data-restore"
                size="sm"
                aria-label="Restore from file…"
                disabled={props.busy}
                onClick={props.onChooseRestoreFile}
              >
                Restore from file…
              </Button>
            </Row>
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={props.preview !== null}
        onOpenChange={(open) => {
          if (!open && !props.restoring) props.onCancelRestore();
        }}
        title="Restore this file?"
        description={props.preview ? restoreParagraphs(props.preview).map((text) => <p key={text}>{text}</p>) : null}
        confirmLabel="Restore and replace"
        destructive
        busy={props.restoring}
        error={props.restoreError}
        onConfirm={props.onConfirmRestore}
      />
    </>
  );
}
