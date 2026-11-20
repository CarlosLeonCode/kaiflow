import { CircleAlert, X } from "lucide-react";

import { useLocale, useT } from "@/shared/i18n";
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
  const t = useT();
  const locale = useLocale();
  const words = t.data;
  const { status } = props;
  return (
    <>
      <Panel title={words.title} description={words.description}>
        {!status ? (
          <div className="p-3" aria-label={words.loading}>
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
                  <Button variant="ghost" size="icon" aria-label={t.common.dismiss} onClick={props.onDismiss}>
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
              label={words.daily}
              description={words.dailyHint}
              controlId="data-backup-enabled"
            >
              <Switch
                id="data-backup-enabled"
                aria-describedby="data-backup-enabled-hint"
                checked={status.enabled}
                onCheckedChange={props.onToggle}
              />
            </Row>

            <Row
              label={words.folder}
              controlId="data-backup-folder"
              description={status.custom_dir ? words.folderCustom : words.folderDefault}
            >
              <div className="flex items-center gap-2">
                <Button
                  id="data-backup-folder"
                  size="sm"
                  aria-label={words.chooseFolder}
                  disabled={props.busy}
                  onClick={props.onChooseFolder}
                >
                  {words.chooseFolder}
                </Button>
                {status.custom_dir && (
                  <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onUseDefaultFolder}>
                    {words.useDefault}
                  </Button>
                )}
              </div>
            </Row>
            <p data-selectable data-testid="backup-folder" className="break-all px-3 pb-2.5 text-xs text-muted-foreground">
              {status.dir}
            </p>

            <Row
              label={words.last}
              description={words.stored(status.stored)}
              controlId="data-backup-now"
            >
              <div className="flex items-center gap-3">
                <span className="tabular text-muted-foreground" data-testid="last-backup">
                  {lastBackupLabel(status.last_backup_at, props.now, t, locale)}
                </span>
                <Button
                  id="data-backup-now"
                  size="sm"
                  aria-label={props.backingUp ? words.backingUp : words.backUpNow}
                  disabled={props.busy}
                  onClick={props.onBackUpNow}
                >
                  {props.backingUp ? words.backingUp : words.backUpNow}
                </Button>
              </div>
            </Row>
            {status.last_error && (
              <div className="px-3 py-2.5">
                <Alert variant="warning" role="alert">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <AlertDescription>{words.lastFailed(status.last_error)}</AlertDescription>
                </Alert>
              </div>
            )}

            <Row
              label={words.restore}
              description={words.restoreHint}
              controlId="data-restore"
            >
              <Button
                id="data-restore"
                size="sm"
                aria-label={words.restoreFromFile}
                disabled={props.busy}
                onClick={props.onChooseRestoreFile}
              >
                {words.restoreFromFile}
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
        title={words.restoreTitle}
        description={
          props.preview ? restoreParagraphs(props.preview, t, locale).map((text) => <p key={text}>{text}</p>) : null
        }
        confirmLabel={words.restoreConfirm}
        destructive
        busy={props.restoring}
        error={props.restoreError}
        onConfirm={props.onConfirmRestore}
      />
    </>
  );
}
