import { useState } from "react";

import { LANGUAGE_NAMES, useLanguage, useT } from "@/shared/i18n";
import {
  errorMessage,
  useAiReviewsQuery,
  useAiSettingsQuery,
  useCancelReviewMutation,
  useDeleteAiReviewMutation,
  useDeleteAllAiReviewsMutation,
  usePrepareDeleteAllAiReviewsMutation,
  usePreviewReviewMutation,
  useRunReviewMutation,
  type AiReviewDto,
  type ReviewPreviewDto,
} from "@/shared/ipc";

import { AiPanel } from "../components/AiPanel";
import { activeProvider, providerLabel } from "../lib/review";

interface Props {
  weeksAgo: number;
  /** Analyses already saved for the week on screen. */
  weekReviews: readonly AiReviewDto[];
  onOpenSettings: () => void;
}

/**
 * Wires the AI card. A run is two steps like every sensitive operation: previewing builds the
 * exact request without sending anything, and only "Send" (with the preview's single-use id)
 * reaches the provider. Nothing here runs by itself.
 */
export function AiPanelContainer({ weeksAgo, weekReviews, onOpenSettings }: Props) {
  const t = useT();
  // The analysis is written in the language the interface uses. The backend takes the
  // language's own name ("English", "Español") and puts it in the instructions as is.
  const language = LANGUAGE_NAMES[useLanguage()];
  const settings = useAiSettingsQuery();
  const history = useAiReviewsQuery();
  const previewReview = usePreviewReviewMutation();
  const run = useRunReviewMutation();
  const cancel = useCancelReviewMutation();
  const remove = useDeleteAiReviewMutation();
  const prepareAll = usePrepareDeleteAllAiReviewsMutation();
  const removeAll = useDeleteAllAiReviewsMutation();

  const provider = activeProvider(settings.data);
  const [titles, setTitles] = useState<boolean | null>(null);
  const includeTitles = titles ?? settings.data?.include_titles ?? false;
  const [preview, setPreview] = useState<ReviewPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const labels = Object.fromEntries((settings.data?.providers ?? []).map((p) => [p.provider, providerLabel(p, t)]));

  return (
    <AiPanel
      loading={settings.isPending}
      provider={provider}
      labels={labels}
      includeTitles={includeTitles}
      onIncludeTitlesChange={setTitles}
      preview={preview}
      previewing={previewReview.isPending}
      running={run.isPending}
      error={error ?? (settings.isError ? t.review.ai.loadError(errorMessage(settings.error, t)) : null)}
      weekReviews={weekReviews}
      history={history.data ?? []}
      onPreview={() => {
        setError(null);
        previewReview.mutate(
          { weeksAgo, includeTitles, language },
          { onSuccess: setPreview, onError: (e) => setError(errorMessage(e, t)) },
        );
      }}
      onSend={() => {
        if (!preview) return;
        setError(null);
        run.mutate(preview.id, {
          onSuccess: () => setPreview(null),
          // The preview is spent either way: a retry builds a fresh one.
          onError: (e) => {
            setPreview(null);
            setError(errorMessage(e, t));
          },
        });
      }}
      onCancelPreview={() => setPreview(null)}
      onCancelRun={() => cancel.mutate()}
      onOpenSettings={onOpenSettings}
      onDeleteReview={(id) => remove.mutate(id, { onError: (e) => setError(errorMessage(e, t)) })}
      confirmDeleteAll={token !== null}
      deleting={removeAll.isPending}
      deleteError={deleteError}
      onAskDeleteAll={() => {
        setDeleteError(null);
        prepareAll.mutate(undefined, { onSuccess: setToken, onError: (e) => setError(errorMessage(e, t)) });
      }}
      onConfirmDeleteAll={() => {
        if (token === null) return;
        removeAll.mutate(token, {
          onSuccess: () => setToken(null),
          onError: (e) => setDeleteError(errorMessage(e, t)),
        });
      }}
      onCancelDeleteAll={() => {
        setToken(null);
        setDeleteError(null);
      }}
    />
  );
}
