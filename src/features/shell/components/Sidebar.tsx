import { CalendarDays, ChartNoAxesColumn, Settings, ShieldCheck, Tags, Target, type LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Kbd } from "@/shared/ui/kbd";

import { SECTIONS, type SectionId } from "../lib/sections";

const ICONS: Record<SectionId, LucideIcon> = {
  today: CalendarDays,
  overview: ChartNoAxesColumn,
  goals: Target,
  activities: Tags,
  privacy: ShieldCheck,
  settings: Settings,
};

interface Props {
  active: SectionId;
  onSelect: (section: SectionId) => void;
  /** Short status line pinned to the bottom (for example "Tracking"). */
  status: { label: string; running: boolean; degraded: boolean } | null;
}

/**
 * Left navigation. The top strip is the draggable title area: the traffic lights float over
 * it (overlay title bar), so it is 44 px tall and carries no controls.
 */
export function Sidebar({ active, onSelect, status }: Props) {
  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-surface">
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <nav aria-label="Sections" className="flex-1 space-y-0.5 px-2">
        {SECTIONS.map((section) => {
          const Icon = ICONS[section.id];
          const current = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              aria-current={current ? "page" : undefined}
              aria-keyshortcuts={`Meta+${section.digit}`}
              onClick={() => onSelect(section.id)}
              // No color transition: the highlight must switch in the same frame as the
              // section. An animated background is sampled from the animation timeline, which
              // only advances while the webview paints, so a throttled or just-shown window
              // kept showing the previous item highlighted.
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm",
                current
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{section.label}</span>
              <Kbd aria-hidden="true" className="border-transparent bg-transparent">
                ⌘{section.digit}
              </Kbd>
            </button>
          );
        })}
      </nav>
      {status && (
        <p className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              status.degraded ? "bg-warning-foreground" : status.running ? "bg-success" : "bg-muted-foreground/50",
            )}
          />
          {status.label}
        </p>
      )}
    </aside>
  );
}
