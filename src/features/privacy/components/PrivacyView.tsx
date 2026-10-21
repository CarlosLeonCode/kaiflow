import type { ReactNode } from "react";
import { CircleAlert, X } from "lucide-react";

import type { DeleteOpDto, PrivacyRulesDto, RetentionImpactDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Panel, Row } from "@/shared/ui/field";
import { Page } from "@/shared/ui/page";
import { Select } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

import { deleteCopy } from "../lib/delete";
import { privacyRows, type PrivacyMode } from "../lib/apps";
import { retentionOptions, retentionValue } from "../lib/retention";
import { AppRulesPanel } from "./AppRulesPanel";
import { DeleteDataPanel } from "./DeleteDataPanel";

interface Props {
  /** Dismissible section introduction, rendered by `Page`. */
  intro?: ReactNode;
  /** `undefined` while loading. */
  privacy: PrivacyRulesDto | undefined;
  retentionDays: number | null;
  apps: readonly AppOption[];
  today: number;
  error: string | null;
  notice: string | null;
  /** Operation waiting for the user's confirmation (token already issued). */
  pending: DeleteOpDto | null;
  trackingWillRestart: boolean;
  /** Dry run of the pending purge of older data; `undefined` until it arrives. */
  impact?: RetentionImpactDto;
  deleting: boolean;
  preparing: boolean;
  deleteError: string | null;
  onOpenSettings: () => void;
  onSetPrivacy: (appId: string, mode: PrivacyMode | null) => Promise<string | null>;
  onRetentionChange: (value: string) => void;
  onRequestDelete: (op: DeleteOpDto) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onFailure: (message: string) => void;
  onDismiss: () => void;
}

/** Privacy section (presentational): what is recorded, what is kept, and how to delete it. */
export function PrivacyView(props: Props) {
  const { privacy, pending } = props;
  const copy = pending ? deleteCopy(pending, props.trackingWillRestart && pending.kind === "all", props.impact) : null;
  return (
    <Page title="Privacy" subtitle="Everything stays on this Mac. Nothing is sent anywhere." intro={props.intro}>
      {!privacy ? (
        <div className="max-w-2xl space-y-3" aria-label="Loading privacy">
          <Skeleton className="h-20" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-6">
          {props.error && (
            <Alert variant="warning" role="alert" className="items-start justify-between">
              <span className="flex gap-2">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <AlertDescription>{props.error}</AlertDescription>
              </span>
              <Button variant="ghost" size="icon" aria-label="Dismiss error" onClick={props.onDismiss}>
                <X />
              </Button>
            </Alert>
          )}
          {props.notice && (
            <Alert variant="neutral" className="items-center justify-between">
              <span>{props.notice}</span>
              <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={props.onDismiss}>
                <X />
              </Button>
            </Alert>
          )}

          <Panel title="Window titles">
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  Window titles are <span data-testid="titles-state">{privacy.store_titles ? "on" : "off"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {privacy.store_titles
                    ? "Titles are stored with your time. Turn them off in Settings to keep only app names."
                    : "Only app names are stored, never window titles. You can turn titles back on in Settings."}
                </p>
              </div>
              <Button size="sm" className="shrink-0" onClick={props.onOpenSettings}>
                Change in Settings
              </Button>
            </div>
          </Panel>

          <AppRulesPanel
            rows={privacyRows(privacy, props.apps)}
            apps={props.apps}
            onSet={props.onSetPrivacy}
            onFailure={props.onFailure}
          />

          <Panel title="Automatic cleanup" description="Applied when the app starts and once a day.">
            <Row
              label="Keep data for"
              description="Older tracked time is deleted automatically."
              controlId="privacy-retention"
            >
              <Select
                id="privacy-retention"
                aria-describedby="privacy-retention-hint"
                value={retentionValue(props.retentionDays)}
                onChange={(event) => props.onRetentionChange(event.target.value)}
              >
                {retentionOptions(props.retentionDays).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <DeleteDataPanel today={props.today} onRequest={props.onRequestDelete} busy={props.preparing || props.deleting} />
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !props.deleting) props.onCancelDelete();
        }}
        title={copy?.title ?? ""}
        description={copy?.paragraphs.map((text) => <p key={text}>{text}</p>)}
        confirmLabel={copy?.confirmLabel ?? "Delete"}
        destructive
        busy={props.deleting}
        error={props.deleteError}
        onConfirm={props.onConfirmDelete}
      />
    </Page>
  );
}
