import type { MomentDto, SealViewDto } from "@/shared/ipc";
import { useT } from "@/shared/i18n";

import { momentContent } from "../lib/moment";
import { MomentCard } from "./MomentCard";
import { MomentDrawing } from "./MomentDrawing";

interface Props {
  moment: MomentDto;
  seals: readonly SealViewDto[];
  /** The card's link: the detail on Goals. */
  onOpen: (moment: MomentDto) => void;
  onDismiss: (moment: MomentDto) => void;
  className?: string;
}

/** The moment to celebrate as its card: words, color and drawing chosen by its kind. */
export function ProgressMoment({ moment, seals, onOpen, onDismiss, className }: Props) {
  const content = momentContent(moment, useT());
  return (
    <MomentCard
      tone={content.tone}
      drawing={<MomentDrawing moment={moment} seals={seals} />}
      title={content.title}
      sentence={content.sentence}
      link={{ label: content.linkLabel, onClick: () => onOpen(moment) }}
      onDismiss={() => onDismiss(moment)}
      className={className}
    />
  );
}
