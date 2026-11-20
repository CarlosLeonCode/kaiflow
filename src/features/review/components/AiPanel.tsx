import { CircleAlert, Loader2, Sparkles, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { useLocale, useT } from "@/shared/i18n";
import type { AiProviderInfoDto, AiReviewDto, ReviewPreviewDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

import { missingKey, providerLabel, reviewTitle, weekLabel } from "../lib/review";
import { RequestPreview } from "./RequestPreview";
import { ReviewResult } from "./ReviewResult";

interface Props {
  /** `undefined` while the settings load. */
  loading: boolean;
  /** The selected provider when it is switched on; `null` otherwise. */
  provider: AiProviderInfoDto | null;
  /** Display names by provider id, for the saved analyses. */
  labels: Readonly<Record<string, string>>;
  includeTitles: boolean;
  onIncludeTitlesChange: (value: boolean) => void;
  preview: ReviewPreviewDto | null;
  previewing: boolean;
  running: boolean;
  error: string | null;
  /** Analyses saved for the week on screen. */
  weekReviews: readonly AiReviewDto[];
  /** Every saved analysis, newest first. */
  history: readonly AiReviewDto[];
  onPreview: () => void;
  onSend: () => void;
  onCancelPreview: () => void;
  onCancelRun: () => void;
  onOpenSettings: () => void;
  onDeleteReview: (id: number) => void;
  /** Delete-all confirmation state. */
  confirmDeleteAll: boolean;
  deleting: boolean;
  deleteError: string | null;
  onAskDeleteAll: () => void;
  onConfirmDeleteAll: () => void;
  onCancelDeleteAll: () => void;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 space-y-3 rounded-lg border border-border bg-background p-4">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Saved({ review, label, onDelete, open }: { review: AiReviewDto; label: string; onDelete: () => void; open: boolean }) {
  const t = useT();
  const locale = useLocale();
  const words = t.review.ai;
  return (
    <li className="py-2">
      <details open={open}>
        <summary className="cursor-pointer text-sm">{reviewTitle(review, label, t, locale)}</summary>
        <div className="mt-2 space-y-2">
          <ReviewResult review={review} />
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {words.whatWasSent}
              {review.included_titles ? words.withTitles : ""}
            </summary>
            <pre
              data-selectable
              tabIndex={0}
              aria-label={words.sentData}
              className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-surface p-2 text-2xs"
            >
              {review.request_json}
            </pre>
          </details>
          <Button
            size="sm"
            variant="ghost"
            aria-label={words.deleteLabel(weekLabel(review.period_label, t))}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" /> {words.delete}
          </Button>
        </div>
      </details>
    </li>
  );
}

/** The optional AI analysis of the week (presentational). Off until a provider is switched on. */
export function AiPanel(props: Props) {
  const t = useT();
  const words = t.review.ai;
  const { provider } = props;
  if (props.loading) {
    return (
      <Card title={words.title}>
        <Skeleton className="h-16" aria-label={words.loading} />
      </Card>
    );
  }

  if (!provider) {
    return (
      <Card title={words.titleOptional}>
        <p className="text-muted-foreground">{words.off}</p>
        <Button onClick={props.onOpenSettings}>
          <Sparkles aria-hidden="true" /> {words.setUp}
        </Button>
        {props.history.length > 0 && (
          <SavedList {...props} />
        )}
      </Card>
    );
  }

  const blocked = missingKey(provider);
  const label = providerLabel(provider, t);
  const busy = props.previewing || props.running;
  return (
    <Card title={words.title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          {label}, {words.model}{" "}
          <span className="font-medium text-foreground">{provider.model || words.notChosen}</span>
          {provider.local ? words.runsHere : "."}
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="review-titles" className="text-sm">
            {words.includeTitles}
          </label>
          <Switch
            id="review-titles"
            checked={props.includeTitles}
            disabled={busy || props.preview !== null}
            onCheckedChange={props.onIncludeTitlesChange}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{words.totalsOnly}</p>

      {blocked && (
        <Alert variant="warning">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription>
            {words.noKey(label)}{" "}
            <button type="button" className="underline" onClick={props.onOpenSettings}>
              {words.addKey}
            </button>
            .
          </AlertDescription>
        </Alert>
      )}
      {props.error && (
        <Alert variant="warning" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription data-testid="ai-error">{props.error}</AlertDescription>
        </Alert>
      )}

      {props.preview ? (
        <RequestPreview
          preview={props.preview}
          providerLabel={label}
          busy={props.running}
          onSend={props.onSend}
          onCancel={props.onCancelPreview}
        />
      ) : props.running ? null : (
        <Button variant="primary" disabled={blocked || busy} onClick={props.onPreview}>
          <Sparkles aria-hidden="true" /> {words.preview}
        </Button>
      )}

      {props.running && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3" role="status">
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {words.analyzing}
          </p>
          <Button size="sm" onClick={props.onCancelRun}>
            {t.common.cancel}
          </Button>
        </div>
      )}

      {props.weekReviews.length === 0 && !props.preview && !props.running && (
        <p className="text-xs text-muted-foreground">{words.noneThisWeek}</p>
      )}
      {props.history.length > 0 && <SavedList {...props} />}
    </Card>
  );
}

function SavedList(props: Props) {
  const words = useT().review.ai;
  const thisWeek = new Set(props.weekReviews.map((r) => r.id));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{words.saved}</h3>
        <Button size="sm" variant="ghost" onClick={props.onAskDeleteAll}>
          <Trash2 aria-hidden="true" /> {words.deleteAll}
        </Button>
      </div>
      <ul aria-label={words.saved} className="divide-y divide-border">
        {props.history.map((review) => (
          <Saved
            key={review.id}
            review={review}
            label={props.labels[review.provider] ?? review.provider}
            open={thisWeek.has(review.id) && review.id === props.weekReviews[0]?.id}
            onDelete={() => props.onDeleteReview(review.id)}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={props.confirmDeleteAll}
        onOpenChange={(open) => !open && props.onCancelDeleteAll()}
        title={words.deleteAllTitle}
        description={<p>{words.deleteAllBody}</p>}
        confirmLabel={words.deleteAll}
        destructive
        busy={props.deleting}
        error={props.deleteError}
        onConfirm={props.onConfirmDeleteAll}
      />
    </div>
  );
}
