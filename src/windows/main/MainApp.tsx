import { useCallback, useState } from "react";

import { CategoriesContainer } from "@/features/categories/containers/CategoriesContainer";
import { HistoryContainer } from "@/features/history/containers/HistoryContainer";
import { PrivacyContainer } from "@/features/privacy/containers/PrivacyContainer";
import { Sidebar } from "@/features/shell/components/Sidebar";
import { useSectionShortcuts } from "@/features/shell/hooks/useSectionShortcuts";
import { DEFAULT_SECTION, type SectionId } from "@/features/shell/lib/sections";
import { SettingsContainer } from "@/features/settings/containers/SettingsContainer";
import { TodayContainer } from "@/features/today/containers/TodayContainer";
import { stateLabel } from "@/features/tracking/lib/derive";
import { useStatusQuery } from "@/shared/ipc";

function SectionView({ section, onNavigate }: { section: SectionId; onNavigate: (next: SectionId) => void }) {
  switch (section) {
    case "today":
      return <TodayContainer />;
    case "history":
      return <HistoryContainer />;
    case "categories":
      return <CategoriesContainer />;
    case "privacy":
      return <PrivacyContainer onOpenSettings={() => onNavigate("settings")} />;
    case "settings":
      return <SettingsContainer />;
  }
}

/**
 * Dashboard window: sidebar + one section. Navigation is plain state, not a router: five
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
                label: status.data.degraded ? "Tracking, titles off" : stateLabel(status.data.state),
                running: status.data.state === "running",
                degraded: status.data.degraded,
              }
            : null
        }
      />
      <main aria-label="Dashboard" className="min-w-0 flex-1 bg-background">
        <SectionView section={section} onNavigate={select} />
      </main>
    </div>
  );
}
