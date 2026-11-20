import { ChevronLeft, ChevronRight } from "lucide-react";

import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

import type { Period } from "../lib/periods";

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
  const words = useT().insights.nav;
  return (
    <div className="flex items-center gap-1" role="group" aria-label={words.label}>
      <Button variant="secondary" size="icon" aria-label={words.previous[period]} onClick={onPrevious}>
        <ChevronLeft />
      </Button>
      <Button variant="secondary" size="icon" aria-label={words.next[period]} onClick={onNext} disabled={!canGoNext}>
        <ChevronRight />
      </Button>
      <h2 aria-live="polite" className="tabular ml-2 text-base font-medium">
        {label}
      </h2>
      <Button variant="ghost" size="sm" className="ml-1" onClick={onToday} disabled={isCurrent}>
        {words.today}
      </Button>
    </div>
  );
}
