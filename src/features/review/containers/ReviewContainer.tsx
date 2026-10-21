import { useState } from "react";

import { useSectionIntro } from "@/features/shell/hooks/useSectionIntro";
import { DEFAULT_WEEK_START } from "@/features/overview/lib/periods";
import { errorMessage, useSetReviewNoteMutation, useSettingsQuery, useWeeklyReviewQuery } from "@/shared/ipc";
import { useIsDark } from "@/shared/lib/theme";

import { NoteField } from "../components/NoteField";
import { ReviewView } from "../components/ReviewView";
import { MAX_WEEKS_AGO } from "../lib/review";
import { AiPanelContainer } from "./AiPanelContainer";

interface Props {
  onOpenGoals: () => void;
  onOpenSettings: () => void;
  /** Takes the user to Activities (the next step of an empty week). */
  onOpenActivities?: () => void;
}

/** Wires the Review section: the week built locally, the personal note and the optional AI panel. */
export function ReviewContainer({ onOpenGoals, onOpenSettings, onOpenActivities }: Props) {
  const intro = useSectionIntro("review");
  const [weeksAgo, setWeeksAgo] = useState(0);
  const dark = useIsDark();
  const settings = useSettingsQuery();
  const review = useWeeklyReviewQuery(weeksAgo);
  const saveNote = useSetReviewNoteMutation();
  const data = review.data;

  return (
    <ReviewView
      intro={intro}
      weeksAgo={weeksAgo}
      canGoPrevious={weeksAgo < MAX_WEEKS_AGO}
      canGoNext={weeksAgo > 0}
      onPrevious={() => setWeeksAgo((n) => Math.min(MAX_WEEKS_AGO, n + 1))}
      onNext={() => setWeeksAgo((n) => Math.max(0, n - 1))}
      onThisWeek={() => setWeeksAgo(0)}
      onOpenActivities={onOpenActivities}
      loading={review.isPending}
      error={review.isError ? errorMessage(review.error) : null}
      dark={dark}
      weekStart={settings.data?.week_start ?? DEFAULT_WEEK_START}
      data={data}
      note={
        data && (
          <NoteField
            key={data.first_day}
            note={data.note}
            saving={saveNote.isPending}
            error={saveNote.isError ? errorMessage(saveNote.error) : null}
            onSave={(note) => saveNote.mutate({ firstDay: data.first_day, note })}
          />
        )
      }
      ai={<AiPanelContainer weeksAgo={weeksAgo} weekReviews={data?.reviews ?? []} onOpenSettings={onOpenSettings} />}
      onOpenGoals={onOpenGoals}
    />
  );
}
