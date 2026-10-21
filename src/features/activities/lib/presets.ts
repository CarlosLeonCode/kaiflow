import type { ApplyPresetResultDto, PresetActivityDto } from "@/shared/ipc";

/**
 * Id under which the older first-run choice ("start empty") was remembered. Still honored, so
 * the guided setup does not reappear for someone who already made that choice.
 */
export const PRESET_CHOICE_ID = "preset-choice";

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "Figma, Sketch, Canva" for the preview of a preset activity; empty when it lists none. */
export function exampleApps(activity: Pick<PresetActivityDto, "example_apps">): string {
  return activity.example_apps.map(capitalize).join(", ");
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Plain-words confirmation of what a pack did. */
export function applySummary(packName: string, result: ApplyPresetResultDto): string {
  if (result.activities_created === 0 && result.rules_created === 0) {
    return `${packName} was already set up: nothing changed.`;
  }
  const parts = [
    result.activities_created > 0 ? `added ${counted(result.activities_created, "activity", "activities")}` : null,
    result.rules_created > 0 ? `${counted(result.rules_created, "rule", "rules")} for apps you already used` : null,
  ].filter((part): part is string => part !== null);
  return `${packName}: ${parts.join(" and ")}.`;
}
