import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { useMemo, useState } from "react";

import {
  useActivitiesQuery,
  useCreateActivityMutation,
  useDeleteActivityMutation,
  useDeleteRuleMutation,
  useReportQuery,
  useRulesQuery,
  useUpdateActivityMutation,
  useUpsertRulesMutation,
  errorMessage,
} from "@/shared/ipc";
import { appOptions, RECENT_APP_DAYS } from "@/shared/lib/apps";
import { useIsDark } from "@/shared/lib/theme";
import { addLocalDays } from "@/shared/lib/time";
import { useNow } from "@/features/tracking/hooks/useNow";

import { ActivitiesView } from "../components/ActivitiesView";
import { toSubmitResult, type SubmitResult } from "../lib/submit";

async function attempt(action: () => Promise<unknown>): Promise<SubmitResult> {
  try {
    await action();
    return null;
  } catch (error) {
    return toSubmitResult(error);
  }
}

/** Wires Activities to the backend: activities, rules and the recently seen apps. */
export function ActivitiesContainer() {
  const now = useNow(60_000);
  const today = addLocalDays(now, 0);
  const range = useMemo(
    () => ({ from: addLocalDays(today, -RECENT_APP_DAYS), to: addLocalDays(today, 1) }),
    [today],
  );
  const activities = useActivitiesQuery();
  const rules = useRulesQuery();
  const recent = useReportQuery(range);
  const dark = useIsDark();
  const [actionError, setActionError] = useState<string | null>(null);

  const create = useCreateActivityMutation();
  const update = useUpdateActivityMutation();
  const remove = useDeleteActivityMutation();
  const upsert = useUpsertRulesMutation();
  const removeRule = useDeleteRuleMutation();

  const ruleList = useMemo(() => rules.data ?? [], [rules.data]);
  const apps = useMemo(() => appOptions(
        recent.data?.by_app ?? [],
        ruleList.flatMap((rule) => (rule.spec.app_id ? [rule.spec.app_id] : [])),
      ), [recent.data, ruleList]);
  const ruleCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const rule of ruleList) counts.set(rule.activity_id, (counts.get(rule.activity_id) ?? 0) + 1);
    return counts;
  }, [ruleList]);

  const failure = activities.error ?? rules.error;

  return (
    <ActivitiesView
      intro={<SectionIntroContainer section="activities" />}
      loading={activities.isPending || rules.isPending}
      error={failure ? errorMessage(failure) : actionError}
      activities={activities.data ?? []}
      rules={ruleList}
      apps={apps}
      ruleCounts={ruleCounts}
      dark={dark}
      onCreate={(value) => attempt(() => create.mutateAsync(value))}
      onUpdate={(activity) => attempt(() => update.mutateAsync(activity))}
      onDeleteActivity={(id) => attempt(() => remove.mutateAsync(id))}
      onSaveRules={(changed) => attempt(() => upsert.mutateAsync(changed))}
      onDeleteRule={(id) => attempt(() => removeRule.mutateAsync(id))}
      onFailure={setActionError}
      onDismissError={() => setActionError(null)}
    />
  );
}
