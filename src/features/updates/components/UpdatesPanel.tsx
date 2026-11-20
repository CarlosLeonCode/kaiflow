import { useT } from "@/shared/i18n";
import type { UpdateInfoDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";
import { Panel, Row } from "@/shared/ui/field";

interface Props {
  /** The announced update, if any. */
  update: UpdateInfoDto | null;
  checking: boolean;
  /** A manual check finished and found nothing newer. */
  upToDate: boolean;
  installing: boolean;
  error: string | null;
  onCheck: () => void;
  onInstall: () => void;
}

/** Settings panel: manual check and install. The app also checks by itself every 24 hours. */
export function UpdatesPanel({ update, checking, upToDate, installing, error, onCheck, onInstall }: Props) {
  const m = useT().updates;
  return (
    <Panel title={m.title}>
      <Row
        label={update ? m.available(update.version) : m.check}
        description={update ? m.signedNote : upToDate ? m.upToDate : m.dailyNote}
        controlId="setting-updates"
        error={error}
      >
        {update ? (
          <Button
            id="setting-updates"
            aria-label={installing ? m.installingLabel : m.installLabel(update.version)}
            variant="primary"
            disabled={installing}
            onClick={onInstall}
          >
            {installing ? m.installing : m.installAndRestart}
          </Button>
        ) : (
          <Button id="setting-updates" aria-label={checking ? m.checkingLabel : m.checkLabel} disabled={checking} onClick={onCheck}>
            {checking ? m.checking : m.checkNow}
          </Button>
        )}
      </Row>
      {update?.notes && (
        <div className="px-3 py-2.5">
          <p className="text-xs font-medium">{m.whatsNew}</p>
          <p data-selectable className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {update.notes}
          </p>
        </div>
      )}
    </Panel>
  );
}
