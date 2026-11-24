import { CalendarDays, ChartNoAxesColumn, Settings, ShieldCheck, Tags, Target, Timer, type LucideIcon } from "lucide-react";

import { useT } from "@/shared/i18n";
import type { OsDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";
import { Kbd } from "@/shared/ui/kbd";

import { SECTION_GROUPS, SECTIONS, sectionAriaShortcut, sectionShortcutLabel, type SectionId } from "../lib/sections";

const ICONS: Record<SectionId, LucideIcon> = {
  today: CalendarDays,
  focus: Timer,
  goals: Target,
  insights: ChartNoAxesColumn,
  activities: Tags,
  privacy: ShieldCheck,
  settings: Settings,
};

interface Props {
  active: SectionId;
  onSelect: (section: SectionId) => void;
  /** Short status line pinned to the bottom (for example "Tracking"). */
  status: { label: string; running: boolean; degraded: boolean } | null;
  /** Shortcut conventions (⌘ on macOS, Ctrl elsewhere). */
  os?: OsDto;
}

/**
 * Left navigation, in three labelled groups (Daily, Look back, Setup). The top strip is the draggable title area: the traffic lights float over
 * it (overlay title bar), so it is 44 px tall and carries no controls.
 */
export function Sidebar({ active, onSelect, status, os = "macos" }: Props) {
  const t = useT();
  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-paper-surface">
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <nav aria-label={t.shell.nav} className="flex-1 space-y-3 px-2">
        {SECTION_GROUPS.map((group) => {
          const headingId = `sidebar-group-${group}`;
          return (
            <div key={group} role="group" aria-labelledby={headingId} className="space-y-0.5">
              <p id={headingId} className="px-2.5 pb-1 font-display text-2xs font-semibold text-muted-foreground">
                {t.shell.groups[group]}
              </p>
              {SECTIONS.filter((section) => section.group === group).map((section) => {
                const Icon = ICONS[section.id];
                const current = section.id === active;
                return (
                  <button
                    key={section.id}
                    type="button"
                    aria-current={current ? "page" : undefined}
                    aria-keyshortcuts={sectionAriaShortcut(section.digit, os)}
                    onClick={() => onSelect(section.id)}
                    // No transition at all (the press drop is instant too): the highlight must
                    // switch in the same frame as the section. An animated background is sampled
                    // from the animation timeline, which only advances while the webview paints,
                    // so a throttled or just-shown window kept showing the previous item
                    // highlighted.
                    className={cn(
                      "flex h-8 w-full items-center gap-2.5 rounded-full border-[1.5px] px-2.5 text-left font-display text-sm motion-safe:active:translate-y-px",
                      current
                        ? "border-mark-stroke bg-background font-bold text-foreground shadow-(--shadow-sticker-sm) active:shadow-none"
                        : "border-transparent font-medium text-muted-foreground hover:bg-mark-stroke/[0.06] hover:text-foreground active:bg-mark-stroke/10",
                    )}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={current ? 2.25 : 2} aria-hidden="true" />
                    <span className="flex-1">{t.shell.sections[section.id]}</span>
                    <Kbd aria-hidden="true" className="border-transparent bg-transparent">
                      {sectionShortcutLabel(section.digit, os)}
                    </Kbd>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      {status && (
        <div className="px-3 pt-2 pb-3">
          {/* Not pressable, so no hard shadow: a flat pill with a hairline edge. */}
          <p className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 font-display text-xs font-semibold text-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                status.degraded ? "bg-warning-foreground" : status.running ? "bg-success" : "bg-muted-foreground",
              )}
            />
            <span className="truncate">{status.label}</span>
          </p>
        </div>
      )}
    </aside>
  );
}
