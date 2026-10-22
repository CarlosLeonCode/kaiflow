import { RotateCcw } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import type { OsDto } from "@/shared/ipc";
import { defaultShortcut, formatShortcut, shortcutFromKeyEvent, shortcutKeys } from "@/shared/lib/shortcut";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";

interface Props {
  id: string;
  value: string;
  /** Keycap labels and the reset default follow the platform. */
  os?: OsDto;
  invalid: boolean;
  describedBy?: string;
  disabled?: boolean;
  onChange: (shortcut: string) => void;
}

/**
 * Click, then press the new combination. Escape cancels. The button is the only tab stop,
 * so the field stays keyboard operable (Enter/Space starts recording like a click).
 */
export function ShortcutField({ id, value, os = "macos", invalid, describedBy, disabled, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const fallback = defaultShortcut(os);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (event.key === "Escape" || event.key === "Tab") {
      setRecording(false);
      return;
    }
    event.preventDefault();
    const next = shortcutFromKeyEvent(event.nativeEvent);
    if (next) {
      setRecording(false);
      if (next !== value) onChange(next);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={recording ? "Press the new shortcut" : `Global shortcut ${formatShortcut(value, os)}, change`}
        onClick={() => setRecording((r) => !r)}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
        className={`flex h-7 min-w-28 items-center justify-center gap-1 rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50 ${
          invalid ? "border-destructive" : "border-border"
        } ${recording ? "bg-accent text-muted-foreground" : "bg-background"}`}
      >
        {recording ? (
          <span>Press shortcut…</span>
        ) : (
          shortcutKeys(value, os).map((key, index) => <Kbd key={`${key}-${index}`}>{key}</Kbd>)
        )}
      </button>
      {value !== fallback && (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Reset shortcut to default"
          disabled={disabled}
          onClick={() => onChange(fallback)}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
