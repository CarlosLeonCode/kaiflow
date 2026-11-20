import type { Messages } from "@/shared/i18n";
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

/** Plain-words confirmation of what a pack did. */
export function applySummary(packName: string, result: ApplyPresetResultDto, t: Messages): string {
  return t.activities.presets.applied(packName, result.activities_created, result.rules_created);
}
