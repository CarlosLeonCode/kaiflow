import { useDismissedIntros } from "@/shared/ipc";
import { SectionIntro } from "@/shared/ui/SectionIntro";

import { INTROS } from "../lib/intros";
import type { SectionId } from "../lib/sections";

/**
 * The intro of one section, passed to `Page`'s `intro` slot. Hidden until settings load (no
 * flash of an intro the user already dismissed) and after it is dismissed (persisted).
 */
export function SectionIntroContainer({ section }: { section: SectionId }) {
  const { ready, isDismissed, dismiss } = useDismissedIntros();
  if (!ready || isDismissed(section)) return null;
  const copy = INTROS[section];
  return (
    <SectionIntro title={copy.title} onDismiss={() => dismiss(section)}>
      {copy.body}
    </SectionIntro>
  );
}
