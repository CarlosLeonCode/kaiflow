import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/shared/ui/button";

interface Props {
  heading: string;
  /** The dates of the week (`2026-10-12 to 2026-10-18`). */
  label: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  isCurrent: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onThisWeek: () => void;
}

/** Previous / next week buttons with the week they show. */
export function WeekNav({ heading, label, canGoPrevious, canGoNext, isCurrent, onPrevious, onNext, onThisWeek }: Props) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="icon" aria-label="Previous week" disabled={!canGoPrevious} onClick={onPrevious}>
        <ChevronLeft />
      </Button>
      <Button variant="secondary" size="icon" aria-label="Next week" disabled={!canGoNext} onClick={onNext}>
        <ChevronRight />
      </Button>
      <div className="min-w-0 px-1" aria-live="polite">
        <p className="font-medium" data-testid="review-heading">
          {heading}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="review-week">
          {label}
        </p>
      </div>
      {!isCurrent && (
        <Button size="sm" onClick={onThisWeek}>
          This week
        </Button>
      )}
    </div>
  );
}
