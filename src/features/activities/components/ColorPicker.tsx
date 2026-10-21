import { Check } from "lucide-react";
import { RadioGroup } from "radix-ui";

import { tuneActivityColor } from "@/shared/lib/color";
import { cn } from "@/shared/lib/utils";

import { PRESET_COLORS, presetFor } from "../lib/palette";

interface Props {
  value: string;
  onChange: (hex: string) => void;
  dark: boolean;
  /** Prefix that keeps ids unique when several pickers are on screen. */
  idPrefix: string;
}

/**
 * Preset swatches (radio group, arrow keys move the selection) plus a native color input for
 * anything else. Swatches are painted with the theme-tuned color, so what you pick is what
 * the charts show.
 */
export function ColorPicker({ value, onChange, dark, idPrefix }: Props) {
  const custom = presetFor(value) === undefined;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RadioGroup.Root
        value={custom ? "" : (presetFor(value)?.hex ?? "")}
        onValueChange={onChange}
        aria-label="Color"
        orientation="horizontal"
        className="flex flex-wrap gap-1.5"
      >
        {PRESET_COLORS.map((preset) => (
          <RadioGroup.Item
            key={preset.hex}
            value={preset.hex}
            aria-label={preset.name}
            title={preset.name}
            className="flex size-5 items-center justify-center rounded-full text-white outline-offset-2 dark:text-black/80"
            style={{ backgroundColor: tuneActivityColor(preset.hex, dark) }}
          >
            <RadioGroup.Indicator>
              <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <label
        htmlFor={`${idPrefix}-custom-color`}
        className={cn(
          "relative flex size-5 cursor-default items-center justify-center overflow-hidden rounded-full border border-dashed border-muted-foreground/60",
          custom && "border-solid border-foreground",
        )}
        title="Custom color"
      >
        <span className="sr-only">Custom color</span>
        <input
          id={`${idPrefix}-custom-color`}
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#3b82f6"}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 size-full cursor-default opacity-0"
        />
        <span
          aria-hidden="true"
          className="size-full rounded-full"
          style={custom ? { backgroundColor: tuneActivityColor(value, dark) } : undefined}
        />
      </label>
    </div>
  );
}
