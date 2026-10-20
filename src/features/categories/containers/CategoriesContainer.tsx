import { useMemo, useState } from "react";

import {
  useCategoriesQuery,
  useCreateCategoryMutation,
  useDeleteCategoryMutation,
  useDeleteRuleMutation,
  useReportQuery,
  useRulesQuery,
  useUpdateCategoryMutation,
  useUpsertRulesMutation,
  errorMessage,
} from "@/shared/ipc";
import { appOptions, RECENT_APP_DAYS } from "@/shared/lib/apps";
import { useIsDark } from "@/shared/lib/theme";
import { addLocalDays } from "@/shared/lib/time";
import { useNow } from "@/features/tracking/hooks/useNow";

import { CategoriesView } from "../components/CategoriesView";
import { toSubmitResult, type SubmitResult } from "../lib/submit";

async function attempt(action: () => Promise<unknown>): Promise<SubmitResult> {
  try {
    await action();
    return null;
  } catch (error) {
    return toSubmitResult(error);
  }
}

/** Wires Categories to the backend: categories, rules and the recently seen apps. */
export function CategoriesContainer() {
  const now = useNow(60_000);
  const today = addLocalDays(now, 0);
  const range = useMemo(
    () => ({ from: addLocalDays(today, -RECENT_APP_DAYS), to: addLocalDays(today, 1) }),
    [today],
  );
  const categories = useCategoriesQuery();
  const rules = useRulesQuery();
  const recent = useReportQuery(range);
  const dark = useIsDark();
  const [actionError, setActionError] = useState<string | null>(null);

  const create = useCreateCategoryMutation();
  const update = useUpdateCategoryMutation();
  const remove = useDeleteCategoryMutation();
  const upsert = useUpsertRulesMutation();
  const removeRule = useDeleteRuleMutation();

  const ruleList = useMemo(() => rules.data ?? [], [rules.data]);
  const apps = useMemo(() => appOptions(
        recent.data?.by_app ?? [],
        ruleList.flatMap((rule) => (rule.spec.app_id ? [rule.spec.app_id] : [])),
      ), [recent.data, ruleList]);
  const ruleCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const rule of ruleList) counts.set(rule.category_id, (counts.get(rule.category_id) ?? 0) + 1);
    return counts;
  }, [ruleList]);

  const failure = categories.error ?? rules.error;

  return (
    <CategoriesView
      loading={categories.isPending || rules.isPending}
      error={failure ? errorMessage(failure) : actionError}
      categories={categories.data ?? []}
      rules={ruleList}
      apps={apps}
      ruleCounts={ruleCounts}
      dark={dark}
      onCreate={(value) => attempt(() => create.mutateAsync(value))}
      onUpdate={(category) => attempt(() => update.mutateAsync(category))}
      onDeleteCategory={(id) => attempt(() => remove.mutateAsync(id))}
      onSaveRules={(changed) => attempt(() => upsert.mutateAsync(changed))}
      onDeleteRule={(id) => attempt(() => removeRule.mutateAsync(id))}
      onFailure={setActionError}
      onDismissError={() => setActionError(null)}
    />
  );
}
