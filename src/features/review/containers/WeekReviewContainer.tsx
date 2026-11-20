import { useT } from "@/shared/i18n";
import { errorMessage, useSetReviewNoteMutation, useWeeklyReviewQuery } from "@/shared/ipc";

import { NoteField } from "../components/NoteField";
import { WeekReviewView } from "../components/WeekReviewView";
import { focusWeek, focusWeekLine, MAX_WEEKS_AGO } from "../lib/review";
import { AiPanelContainer } from "./AiPanelContainer";

interface Props {
  /**
   * The week on screen, as whole weeks before the current one. The backend keys the note and
   * the saved analyses by the same count and the same first day of the week as Insights.
   */
  weeksAgo: number;
  onOpenSettings: () => void;
}

function LoadedWeekReview({ weeksAgo, onOpenSettings }: Props) {
  const t = useT();
  const review = useWeeklyReviewQuery(weeksAgo);
  const saveNote = useSetReviewNoteMutation();
  const data = review.data;

  return (
    <WeekReviewView
      loading={review.isPending}
      error={review.isError ? errorMessage(review.error, t) : null}
      goals={data?.goals}
      focusLine={data ? focusWeekLine(focusWeek(data.focus), t) : undefined}
      note={
        data && (
          <NoteField
            key={data.first_day}
            note={data.note}
            saving={saveNote.isPending}
            error={saveNote.isError ? errorMessage(saveNote.error, t) : null}
            onSave={(note) => saveNote.mutate({ firstDay: data.first_day, note })}
          />
        )
      }
      ai={<AiPanelContainer weeksAgo={weeksAgo} weekReviews={data?.reviews ?? []} onOpenSettings={onOpenSettings} />}
    />
  );
}

/** Wires the weekly review of the Insights Week view: goals, focus sessions, the note and the AI panel. */
export function WeekReviewContainer(props: Props) {
  if (props.weeksAgo < 0 || props.weeksAgo > MAX_WEEKS_AGO) return <WeekReviewView tooFarBack />;
  return <LoadedWeekReview {...props} />;
}
