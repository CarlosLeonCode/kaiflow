import { useT } from "@/shared/i18n";
import type { ReviewPreviewDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

import { bytesLabel, destinationText, titlesText } from "../lib/review";

interface Props {
  preview: ReviewPreviewDto;
  /** Display name of the provider. */
  providerLabel: string;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
}

/** "What will be sent": the exact request, shown before anything leaves the computer. */
export function RequestPreview({ preview, providerLabel, busy, onSend, onCancel }: Props) {
  const t = useT();
  const words = t.review.request;
  return (
    <section
      aria-label={words.title}
      className="space-y-3 rounded-md border border-border bg-surface p-3"
      data-testid="request-preview"
    >
      <div>
        <h3 className="font-medium">{words.title}</h3>
        <p className="text-xs text-muted-foreground" data-testid="preview-destination">
          {destinationText(preview, providerLabel, t)} {titlesText(preview, t)}{" "}
          {words.inTotal(bytesLabel(preview.bytes, t))}
        </p>
      </div>
      <div>
        <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{words.yourData}</h4>
        <pre
          data-selectable
          data-testid="preview-data"
          tabIndex={0}
          aria-label={words.dataLabel}
          className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-2xs"
        >
          {preview.user}
        </pre>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">{words.instructions}</summary>
        <pre
          data-selectable
          tabIndex={0}
          aria-label={words.instructionsLabel}
          className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-2xs"
        >
          {preview.system}
        </pre>
      </details>
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          {t.common.cancel}
        </Button>
        <Button size="sm" variant="primary" onClick={onSend} disabled={busy}>
          {preview.local ? words.analyzeHere : words.send}
        </Button>
      </div>
    </section>
  );
}
