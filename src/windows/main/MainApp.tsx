import { useCallback, useState } from "react";

import { BackupNoticeContainer } from "@/features/data/containers/BackupNoticeContainer";
import { ActivitiesContainer } from "@/features/activities/containers/ActivitiesContainer";
import { FocusContainer } from "@/features/focus/containers/FocusContainer";
import { GoalsContainer } from "@/features/goals/containers/GoalsContainer";
import { InsightsContainer } from "@/features/insights/containers/InsightsContainer";
import { PrivacyContainer } from "@/features/privacy/containers/PrivacyContainer";
import { Sidebar } from "@/features/shell/components/Sidebar";
import { useMainSectionRequests } from "@/features/shell/hooks/useMainSectionRequests";
import { useSectionShortcuts } from "@/features/shell/hooks/useSectionShortcuts";
import { DEFAULT_SECTION, type SectionId } from "@/features/shell/lib/sections";
import { SettingsContainer } from "@/features/settings/containers/SettingsContainer";
import { TodayContainer } from "@/features/today/containers/TodayContainer";
import { degradedLabel, stateLabel } from "@/features/tracking/lib/derive";
import { useT } from "@/shared/i18n";
import { usePlatformQuery, useStatusQuery } from "@/shared/ipc";
import { osOf } from "@/shared/lib/platform";

interface SectionViewProps {
  section: SectionId;
  onNavigate: (next: SectionId) => void;
  /** Bumped when another window opened Goals for its progress: Goals scrolls to the panel. */
  revealProgress: number;
}

function SectionView({ section, onNavigate, revealProgress }: SectionViewProps) {
  switch (section) {
    case "today":
      return <TodayContainer onOpenGoals={() => onNavigate("goals")} onOpenActivities={() => onNavigate("activities")} />;
    case "focus":
      return <FocusContainer />;
    case "goals":
      return <GoalsContainer revealProgress={revealProgress} />;
    case "insights":
      return (
        <InsightsContainer
          onOpenActivities={() => onNavigate("activities")}
          onOpenSettings={() => onNavigate("settings")}
        />
      );
    case "activities":
      return <ActivitiesContainer />;
    case "privacy":
      return <PrivacyContainer onOpenSettings={() => onNavigate("settings")} />;
    case "settings":
      return <SettingsContainer />;
  }
}

/**
 * Dashboard window: sidebar + one section. Navigation is plain state, not a router: seven
 * fixed sections, no deep links (a webview has no address bar), and the window is hidden
 * rather than closed, so the selection survives. This avoids a routing dependency
 * (deviation from the design's `react-router` note, which assumed deep links).
 */
export function MainApp() {
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const [revealProgress, setRevealProgress] = useState(0);
  const select = useCallback((next: SectionId) => {
    setSection(next);
    setRevealProgress(0);
  }, []);
  const os = osOf(usePlatformQuery().data);
  useSectionShortcuts(select, os);
  // The popover's strokes chip and moment link open Goals on the progress panel.
  useMainSectionRequests((next) => {
    setSection(next);
    setRevealProgress((count) => (next === "goals" ? count + 1 : 0));
  });
  const status = useStatusQuery();
  const t = useT();

  return (
    <div className="flex h-full">
      <Sidebar
        active={section}
        onSelect={select}
        os={os}
        status={
          status.data
            ? {
                label: status.data.degraded ? degradedLabel(status.data.degraded_reason, t) : stateLabel(status.data.state, t),
                running: status.data.state === "running",
                degraded: status.data.degraded,
              }
            : null
        }
      />
      <main aria-label={t.shell.dashboard} className="flex min-w-0 flex-1 flex-col bg-background">
        <BackupNoticeContainer />
        <div className="min-h-0 flex-1">
          <SectionView section={section} onNavigate={select} revealProgress={revealProgress} />
        </div>
      </main>
    </div>
  );
}
