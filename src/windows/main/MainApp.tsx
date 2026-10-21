import { useCallback, useState } from "react";

import { BackupNoticeContainer } from "@/features/data/containers/BackupNoticeContainer";
import { ActivitiesContainer } from "@/features/activities/containers/ActivitiesContainer";
import { FocusContainer } from "@/features/focus/containers/FocusContainer";
import { GoalsContainer } from "@/features/goals/containers/GoalsContainer";
import { OverviewContainer } from "@/features/overview/containers/OverviewContainer";
import { ReviewContainer } from "@/features/review/containers/ReviewContainer";
import { PrivacyContainer } from "@/features/privacy/containers/PrivacyContainer";
import { Sidebar } from "@/features/shell/components/Sidebar";
import { useSectionShortcuts } from "@/features/shell/hooks/useSectionShortcuts";
import { DEFAULT_SECTION, type SectionId } from "@/features/shell/lib/sections";
import { SettingsContainer } from "@/features/settings/containers/SettingsContainer";
import { TodayContainer } from "@/features/today/containers/TodayContainer";
import { degradedLabel, stateLabel } from "@/features/tracking/lib/derive";
import { useStatusQuery } from "@/shared/ipc";

function SectionView({ section, onNavigate }: { section: SectionId; onNavigate: (next: SectionId) => void }) {
  switch (section) {
    case "today":
      return <TodayContainer onOpenGoals={() => onNavigate("goals")} onOpenActivities={() => onNavigate("activities")} />;
    case "overview":
      return <OverviewContainer onOpenActivities={() => onNavigate("activities")} />;
    case "goals":
      return <GoalsContainer />;
    case "focus":
      return <FocusContainer />;
    case "review":
      return (
        <ReviewContainer
          onOpenGoals={() => onNavigate("goals")}
          onOpenSettings={() => onNavigate("settings")}
          onOpenActivities={() => onNavigate("activities")}
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
 * Dashboard window: sidebar + one section. Navigation is plain state, not a router: eight
 * fixed sections, no deep links (a webview has no address bar), and the window is hidden
 * rather than closed, so the selection survives. This avoids a routing dependency
 * (deviation from the design's `react-router` note, which assumed deep links).
 */
export function MainApp() {
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const select = useCallback((next: SectionId) => setSection(next), []);
  useSectionShortcuts(select);
  const status = useStatusQuery();

  return (
    <div className="flex h-full">
      <Sidebar
        active={section}
        onSelect={select}
        status={
          status.data
            ? {
                label: status.data.degraded ? degradedLabel(status.data.degraded_reason) : stateLabel(status.data.state),
                running: status.data.state === "running",
                degraded: status.data.degraded,
              }
            : null
        }
      />
      <main aria-label="Dashboard" className="flex min-w-0 flex-1 flex-col bg-background">
        <BackupNoticeContainer />
        <div className="min-h-0 flex-1">
          <SectionView section={section} onNavigate={select} />
        </div>
      </main>
    </div>
  );
}
