import { CircleHelp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useDismissedIntros, usePlatformQuery } from "@/shared/ipc";
import { osOf } from "@/shared/lib/platform";
import { Button } from "@/shared/ui/button";
import type { IntroSlot } from "@/shared/ui/page";
import { SectionIntro } from "@/shared/ui/SectionIntro";

import { introFor } from "../lib/intros";
import { SECTIONS, type SectionId } from "../lib/sections";

function HelpButton({
  label,
  controls,
  expanded,
  focusRequest,
  onClick,
}: {
  label: string;
  controls: string;
  expanded: boolean;
  focusRequest: number;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusRequest > 0) ref.current?.focus();
  }, [focusRequest]);
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      aria-label={`Help for ${label}`}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      title={`About ${label}`}
      onClick={onClick}
    >
      <CircleHelp />
    </Button>
  );
}

/**
 * The intro of one section plus the "?" button for the page header (both go to `Page`'s
 * `intro` slot). The intro is hidden until settings load, so one the user already dismissed
 * never flashes. Dismissing it moves focus to the help button; the help button reopens it (or,
 * when it is already open, moves focus to it).
 */
export function useSectionIntro(section: SectionId): IntroSlot {
  const { ready, isDismissed, dismiss, restore } = useDismissedIntros();
  const os = osOf(usePlatformQuery().data);
  const [focusIntro, setFocusIntro] = useState(0);
  const [focusHelp, setFocusHelp] = useState(0);
  const visible = ready && !isDismissed(section);
  const id = `section-intro-${section}`;
  const label = SECTIONS.find((item) => item.id === section)?.label ?? section;

  return {
    body: visible ? (
      <SectionIntro
        id={id}
        content={introFor(section, os)}
        focusRequest={focusIntro}
        onDismiss={() => {
          dismiss(section);
          setFocusHelp((n) => n + 1);
        }}
      />
    ) : null,
    help: ready ? (
      <HelpButton
        label={label}
        controls={id}
        expanded={visible}
        focusRequest={focusHelp}
        onClick={() => {
          if (!visible) restore(section);
          setFocusIntro((n) => n + 1);
        }}
      />
    ) : null,
  };
}
