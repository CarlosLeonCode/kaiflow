import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { GoalWeekDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Skeleton } from "@/shared/ui/skeleton";

import { Card } from "@/features/insights/components/Card";

import { dayName, goalWeekLine, MAX_WEEKS_AGO, RESULT_LABEL } from "../lib/review";

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
  if (tooFarBack) {
    return (
      <p className="text-xs text-muted-foreground">
        Notes and AI analysis cover the last {MAX_WEEKS_AGO} weeks.
      </p>
    );
  }
  if (error) {
    return (
      <Alert variant="warning" role="alert">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <AlertDescription>Could not load the weekly review: {error}</AlertDescription>
      </Alert>
    );
  }
  if (loading) {
    return (
      <div aria-label="Loading the weekly review">
        <Skeleton className="h-28" />
      </div>
    );
  }
  return (
    <>
      {/* Without goals there is nothing to review; goals are created in the Goals section. */}
      {goals.length > 0 && (
        <Card title="Goals this week" hint="How each goal fared this week">
          <ul aria-label="Goals this week" className="divide-y divide-border">
            {goals.map((week) => (
              <li key={week.goal.id} className="flex items-baseline justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{week.goal.label}</p>
                  <p className="text-xs text-muted-foreground">{goalWeekLine(week)}</p>
                  {week.goal.period === "daily" && (
                    <p className="mt-1 flex gap-1" aria-hidden="true">
                      {week.periods.map((p) => (
                        <span
                          key={p.start_day}
                          title={`${dayName(p.start_day)}: ${RESULT_LABEL[p.result]}`}
                          className={`rounded px-1 text-2xs ${
                            p.result === "met"
                              ? "bg-success/20 text-foreground"
                              : p.result === "missed"
                                ? "bg-warning text-warning-foreground"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {dayName(p.start_day)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <p className="tabular shrink-0 text-xs text-muted-foreground">
                  Streak {week.current_streak} · best {week.best_streak}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Focus sessions">
        <p data-testid="review-focus" className="text-sm">
          {focusLine}
        </p>
      </Card>

      <Card title="Your note" hint="Private. Never sent to an AI">
        {note}
      </Card>

      {ai}
    </>
  );
}
