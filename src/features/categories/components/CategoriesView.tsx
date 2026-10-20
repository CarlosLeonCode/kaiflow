import { CircleAlert } from "lucide-react";

import type { CategoryDto, RuleDto, RuleInputDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Page } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";

import type { Submit } from "../lib/submit";
import { CategoryPanel } from "./CategoryPanel";
import { RulesPanel } from "./RulesPanel";

interface Props {
  loading: boolean;
  error: string | null;
  categories: readonly CategoryDto[];
  rules: readonly RuleDto[];
  apps: readonly AppOption[];
  ruleCounts: ReadonlyMap<number, number>;
  dark: boolean;
  onCreate: Submit<{ name: string; color: string }>;
  onUpdate: Submit<CategoryDto>;
  onDeleteCategory: Submit<number>;
  onSaveRules: Submit<readonly RuleInputDto[]>;
  onDeleteRule: Submit<number>;
  onFailure: (message: string) => void;
  onDismissError: () => void;
}

/** Categories section (presentational): categories on the left, ordered rules on the right. */
export function CategoriesView({
  loading,
  error,
  categories,
  rules,
  apps,
  ruleCounts,
  dark,
  onCreate,
  onUpdate,
  onDeleteCategory,
  onSaveRules,
  onDeleteRule,
  onFailure,
  onDismissError,
}: Props) {
  return (
    <Page title="Categories" subtitle="Organize your time with categories and rules.">
      {error && (
        <Alert variant="warning" role="alert" className="mb-4 items-start justify-between">
          <span className="flex gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </span>
          <button type="button" onClick={onDismissError} className="shrink-0 underline underline-offset-2">
            Dismiss
          </button>
        </Alert>
      )}
      {loading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" aria-label="Loading categories">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <CategoryPanel
            categories={categories}
            ruleCounts={ruleCounts}
            dark={dark}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onDelete={onDeleteCategory}
          />
          <RulesPanel
            rules={rules}
            categories={categories}
            apps={apps}
            onSave={onSaveRules}
            onDelete={onDeleteRule}
            onFailure={onFailure}
          />
        </div>
      )}
    </Page>
  );
}
