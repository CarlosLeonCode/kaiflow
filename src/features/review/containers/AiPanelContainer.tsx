import { useState } from "react";

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
import { activeProvider } from "../lib/review";

/** The language the analysis is written in: the one the interface uses. */
const LANGUAGE = "English";

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

  const labels = Object.fromEntries((settings.data?.providers ?? []).map((p) => [p.provider, p.label]));

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
      error={error ?? (settings.isError ? `Could not load AI settings: ${errorMessage(settings.error)}` : null)}
      weekReviews={weekReviews}
      history={history.data ?? []}
      onPreview={() => {
        setError(null);
        previewReview.mutate(
          { weeksAgo, includeTitles, language: LANGUAGE },
          { onSuccess: setPreview, onError: (e) => setError(errorMessage(e)) },
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
            setError(errorMessage(e));
          },
        });
      }}
      onCancelPreview={() => setPreview(null)}
      onCancelRun={() => cancel.mutate()}
      onOpenSettings={onOpenSettings}
      onDeleteReview={(id) => remove.mutate(id, { onError: (e) => setError(errorMessage(e)) })}
      confirmDeleteAll={token !== null}
      deleting={removeAll.isPending}
      deleteError={deleteError}
      onAskDeleteAll={() => {
        setDeleteError(null);
        prepareAll.mutate(undefined, { onSuccess: setToken, onError: (e) => setError(errorMessage(e)) });
      }}
      onConfirmDeleteAll={() => {
        if (token === null) return;
        removeAll.mutate(token, {
          onSuccess: () => setToken(null),
          onError: (e) => setDeleteError(errorMessage(e)),
        });
      }}
      onCancelDeleteAll={() => {
        setToken(null);
        setDeleteError(null);
      }}
    />
  );
}
