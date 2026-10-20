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
  return (
    <Panel title="Updates">
      <Row
        label={update ? `Version ${update.version} is available` : "Check for updates"}
        description={
          update
            ? "Installing restarts the app. Updates are signed and verified before they are applied."
            : upToDate
              ? "You are on the latest version."
              : "The app checks once a day. This is the only time it uses the network."
        }
        controlId="setting-updates"
        error={error}
      >
        {update ? (
          <Button
            id="setting-updates"
            aria-label={installing ? "Installing update" : `Install and restart to version ${update.version}`}
            variant="primary"
            disabled={installing}
            onClick={onInstall}
          >
            {installing ? "Installing..." : "Install and restart"}
          </Button>
        ) : (
          <Button id="setting-updates" aria-label={checking ? "Checking for updates" : "Check now for updates"} disabled={checking} onClick={onCheck}>
            {checking ? "Checking..." : "Check now"}
          </Button>
        )}
      </Row>
      {update?.notes && (
        <div className="px-3 py-2.5">
          <p className="text-xs font-medium">What is new</p>
          <p data-selectable className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {update.notes}
          </p>
        </div>
      )}
    </Panel>
  );
}
