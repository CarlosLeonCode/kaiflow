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
  return (
    <section
      aria-label="What will be sent"
      className="space-y-3 rounded-md border border-border bg-surface p-3"
      data-testid="request-preview"
    >
      <div>
        <h3 className="font-medium">What will be sent</h3>
        <p className="text-xs text-muted-foreground" data-testid="preview-destination">
          {destinationText(preview, providerLabel)} {titlesText(preview)} {bytesLabel(preview.bytes)} in total.
        </p>
      </div>
      <div>
        <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Your data</h4>
        <pre
          data-selectable
          data-testid="preview-data"
          tabIndex={0}
          aria-label="The data that will be sent"
          className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-2xs"
        >
          {preview.user}
        </pre>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Instructions given to the model</summary>
        <pre
          data-selectable
          tabIndex={0}
          aria-label="The instructions that will be sent"
          className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-2xs"
        >
          {preview.system}
        </pre>
      </details>
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={onSend} disabled={busy}>
          {preview.local ? "Analyze on this computer" : "Send for analysis"}
        </Button>
      </div>
    </section>
  );
}
