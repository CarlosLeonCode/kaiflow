import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { useLocale, useT } from "@/shared/i18n";
import type { GoalWeekDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Skeleton } from "@/shared/ui/skeleton";

import { Card } from "@/features/insights/components/Card";

import { dayName, goalWeekLine, MAX_WEEKS_AGO } from "../lib/review";

interface Props {
  /** The week is older than the review keeps (no note or analysis can be stored for it). */
  tooFarBack?: boolean;
  loading?: boolean;
  error?: string | null;
  /** How each goal fared in the week, day by day for daily goals. */
  goals?: readonly GoalWeekDto[];
  /** One sentence on the focus sessions of the week. */
  focusLine?: string;
  /** The personal note editor (keyed by week by the container). */
  note?: ReactNode;
  /** The optional AI analysis. */
  ai?: ReactNode;
}

/**
 * The weekly review below the Insights cards in the Week view (presentational): how each goal
 * fared, focus sessions, the personal note and the optional AI analysis. Everything but the AI
 * card is built on this computer, so the week is useful with AI switched off, which is the default.
 */
export function WeekReviewView({ tooFarBack, loading, error, goals = [], focusLine, note, ai }: Props) {
  const t = useT();
  const locale = useLocale();
  const words = t.review;
  if (tooFarBack) {
    return <p className="text-xs text-muted-foreground">{words.tooFarBack(MAX_WEEKS_AGO)}</p>;
  }
  if (error) {
    return (
      <Alert variant="warning" role="alert">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <AlertDescription>{words.loadError(error)}</AlertDescription>
      </Alert>
    );
  }
  if (loading) {
    return (
      <div aria-label={words.loading}>
        <Skeleton className="h-28" />
      </div>
    );
  }
  return (
    <>
      {/* Without goals there is nothing to review; goals are created in the Goals section. */}
      {goals.length > 0 && (
        <Card title={words.goalsThisWeek} hint={words.goalsHint}>
          <ul aria-label={words.goalsThisWeek} className="divide-y divide-border">
            {goals.map((week) => (
              <li key={week.goal.id} className="flex items-baseline justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{week.goal.label}</p>
                  <p className="text-xs text-muted-foreground">{goalWeekLine(week, t)}</p>
                  {week.goal.period === "daily" && (
                    <p className="mt-1 flex gap-1" aria-hidden="true">
                      {week.periods.map((p) => (
                        <span
                          key={p.start_day}
                          title={`${dayName(p.start_day, locale)}: ${words.results[p.result]}`}
                          className={`rounded px-1 text-2xs ${
                            p.result === "met"
                              ? "bg-success/20 text-foreground"
                              : p.result === "missed"
                                ? "bg-warning text-warning-foreground"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {dayName(p.start_day, locale)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <p className="tabular shrink-0 text-xs text-muted-foreground">
                  {words.streak(week.current_streak, week.best_streak)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={words.focusSessions}>
        <p data-testid="review-focus" className="text-sm">
          {focusLine}
        </p>
      </Card>

      <Card title={words.yourNote} hint={words.noteHint}>
        {note}
      </Card>

      {ai}
    </>
  );
}
