import type { RuleDto, RuleInputDto, RuleSpecDto } from "@/shared/ipc";
import { UNASSIGNED_LABEL } from "@/shared/lib/labels";

/** Pure helpers for the activity rules UI (no IPC). */

export type RuleKind = RuleSpecDto["kind"];

/**
 * Matching order (domain `classify`): title patterns beat app rules; inside a group the
 * highest `priority` wins, then the lowest `id`. This is the order the list is shown in.
 */
export function tierOf(rules: readonly RuleDto[], kind: RuleKind): RuleDto[] {
  return rules
    .filter((rule) => rule.spec.kind === kind)
    .sort((a, b) => b.priority - a.priority || a.id - b.id);
}

/** Priority that puts a new rule on top of its group. */
export function nextPriority(rules: readonly RuleDto[], kind: RuleKind): number {
  const top = tierOf(rules, kind)[0];
  return top ? top.priority + 1 : 1;
}

export type Direction = "up" | "down";

/**
 * Moves a rule one place inside its group and returns the rules whose priority changed.
 * Priorities of the whole group are renumbered `n..1` (top = highest), which also fixes
 * ties, so the shown order is exactly the order the backend applies.
 */
export function moveRule(rules: readonly RuleDto[], id: number, direction: Direction): RuleInputDto[] {
  const target = rules.find((rule) => rule.id === id);
  if (!target) return [];
  const group = tierOf(rules, target.spec.kind);
  const from = group.findIndex((rule) => rule.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= group.length) return [];
  const reordered = [...group];
  reordered.splice(to, 0, ...reordered.splice(from, 1));
  const changed: RuleInputDto[] = [];
  reordered.forEach((rule, index) => {
    const priority = reordered.length - index;
    if (rule.priority !== priority) {
      changed.push({ id: rule.id, activity_id: rule.activity_id, spec: rule.spec, priority });
    }
  });
  return changed;
}

export function canMove(rules: readonly RuleDto[], id: number, direction: Direction): boolean {
  return moveRule(rules, id, direction).length > 0;
}

export type NameProblem = "empty" | "too_long" | "duplicate";

export const MAX_NAME_LENGTH = 40;

/** Client-side checks that give instant feedback; the backend still validates. */
export function nameProblem(
  name: string,
  existing: readonly { id: number; name: string }[],
  editingId: number | null,
): NameProblem | null {
  const value = name.trim();
  if (value.length === 0) return "empty";
  if (value.length > MAX_NAME_LENGTH) return "too_long";
  const lower = value.toLowerCase();
  const clash =
    lower === UNASSIGNED_LABEL.toLowerCase() ||
    existing.some((activity) => activity.id !== editingId && activity.name.trim().toLowerCase() === lower);
  return clash ? "duplicate" : null;
}

export function nameProblemMessage(problem: NameProblem): string {
  switch (problem) {
    case "empty":
      return "Give the activity a name.";
    case "too_long":
      return `Use at most ${MAX_NAME_LENGTH} characters.`;
    case "duplicate":
      return "An activity with this name already exists.";
  }
}
