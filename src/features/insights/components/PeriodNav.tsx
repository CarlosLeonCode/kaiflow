import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/shared/ui/button";

import { periodNoun, type Period } from "../lib/periods";

interface Props {
  period: Period;
  label: string;
  canGoNext: boolean;
  isCurrent: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

/** Previous / next arrows around the period label, plus a jump back to the present. */
export function PeriodNav({ period, label, canGoNext, isCurrent, onPrevious, onNext, onToday }: Props) {
  const noun = periodNoun(period);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Date navigation">
      <Button variant="secondary" size="icon" aria-label={`Previous ${noun}`} onClick={onPrevious}>
        <ChevronLeft />
      </Button>
      <Button variant="secondary" size="icon" aria-label={`Next ${noun}`} onClick={onNext} disabled={!canGoNext}>
        <ChevronRight />
      </Button>
      <h2 aria-live="polite" className="tabular ml-2 text-base font-medium">
        {label}
      </h2>
      <Button variant="ghost" size="sm" className="ml-1" onClick={onToday} disabled={isCurrent}>
        Today
      </Button>
    </div>
  );
}
