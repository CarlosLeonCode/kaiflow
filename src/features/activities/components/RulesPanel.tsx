import { ArrowRight, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

import type { ActivityDto, RuleDto, RuleInputDto, RuleSpecDto } from "@/shared/ipc";
import { appName, type AppOption } from "@/shared/lib/apps";
import { activityLabel } from "@/shared/lib/labels";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/select";

import { canMove, moveRule, nextPriority, tierOf, type RuleKind } from "../lib/rules";
import type { Submit } from "../lib/submit";
import { containsText } from "../lib/titleMatch";
import { RuleForm } from "./RuleForm";
import type { RulePreviewState } from "./RulePreview";

interface Props {
  rules: readonly RuleDto[];
  activities: readonly ActivityDto[];
  apps: readonly AppOption[];
  /** Creates or updates rules (an input with `id <= 0` is new). */
  onSave: Submit<readonly RuleInputDto[]>;
  onDelete: Submit<number>;
  /** Failures of in-list actions (reorder, change activity, delete) have no form to live in. */
  onFailure: (message: string) => void;
  onDraftChange?: (spec: RuleSpecDto | null) => void;
  preview?: RulePreviewState;
  previewDays?: number;
}

/**
 * What a rule matches, as text: the app name, `Title contains "text"` for a plain-text rule or
 * `/pattern/` for a regular expression, optionally limited to one app.
 */
export function describeSpec(spec: RuleSpecDto, apps: readonly AppOption[]): string {
  if (spec.kind === "app") return appName(apps, spec.app_id);
  const text = containsText(spec.pattern);
  const what = text === null ? `/${spec.pattern}/` : `Title contains \u201c${text}\u201d`;
  return `${what}${spec.app_id ? ` in ${appName(apps, spec.app_id)}` : ""}`;
}

const GROUPS: readonly { kind: RuleKind; title: string; hint: string }[] = [
  { kind: "title_pattern", title: "Window titles", hint: "Checked first" },
  { kind: "app", title: "Apps", hint: "Used when no title pattern matches" },
];

/** Rules form plus the ordered rule lists. Within a group the rule higher up wins. */
export function RulesPanel({
  rules,
  activities,
  apps,
  onSave,
  onDelete,
  onFailure,
  onDraftChange,
  preview,
  previewDays,
}: Props) {
  async function save(changed: readonly RuleInputDto[]) {
    const result = await onSave(changed);
    if (result) onFailure(result.message);
  }

  async function reorder(id: number, direction: "up" | "down") {
    const changed = moveRule(rules, id, direction);
    if (changed.length > 0) await save(changed);
  }

  async function remove(id: number) {
    const result = await onDelete(id);
    if (result) onFailure(result.message);
  }

  return (
    <section aria-label="Rules" className="space-y-2">
      <div className="px-1">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Rules</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A rule says which time belongs to an activity. Rules also sort time you already tracked, and you can change
          them any time.
        </p>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        <RuleForm
          activities={activities}
          apps={apps}
          onDraftChange={onDraftChange}
          preview={preview}
          previewDays={previewDays}
          onSubmit={({ spec, activityId }) =>
            onSave([{ id: 0, activity_id: activityId, spec, priority: nextPriority(rules, spec.kind) }])
          }
        />

        {rules.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No rules yet. Add one above: matching time, past and new, moves out of Unassigned.
          </p>
        ) : (
          GROUPS.map((group) => {
            const items = tierOf(rules, group.kind);
            if (items.length === 0) return null;
            return (
              <div key={group.kind}>
                <h3 className="flex items-baseline justify-between px-3 pt-2.5 text-xs font-medium">
                  {group.title}
                  <span className="font-normal text-muted-foreground">{group.hint}</span>
                </h3>
                <ul aria-label={`${group.title} rules`} className="px-1.5 py-1.5">
                  {items.map((rule) => {
                    const label = describeSpec(rule.spec, apps);
                    return (
                      <li key={rule.id} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/50">
                        <span className="flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label={`Move ${label} up`}
                            disabled={!canMove(rules, rule.id, "up")}
                            onClick={() => void reorder(rule.id, "up")}
                          >
                            <ChevronUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label={`Move ${label} down`}
                            disabled={!canMove(rules, rule.id, "down")}
                            onClick={() => void reorder(rule.id, "down")}
                          >
                            <ChevronDown />
                          </Button>
                        </span>
                        <span
                          data-selectable
                          className={`min-w-0 flex-1 truncate px-1 ${rule.spec.kind === "title_pattern" && containsText(rule.spec.pattern) === null ? "font-mono text-xs" : ""}`}
                          title={label}
                        >
                          {label}
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <Select
                          aria-label={`Activity for ${label}`}
                          value={rule.activity_id}
                          className="max-w-36"
                          onChange={(event) =>
                            void save([
                              { id: rule.id, activity_id: Number(event.target.value), spec: rule.spec, priority: rule.priority },
                            ])
                          }
                        >
                          {activities.map((activity) => (
                            <option key={activity.id} value={activity.id}>
                              {activityLabel(activity.id, activity.name)}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete rule ${label}`}
                          onClick={() => void remove(rule.id)}
                        >
                          <Trash2 />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
