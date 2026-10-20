import { IdlePromptContainer } from "@/features/idle-prompt/containers/IdlePromptContainer";
import { useEscapeToHide } from "@/features/tracking/hooks/useEscapeToHide";
import { TrackingPopoverContainer } from "@/features/tracking/containers/TrackingPopoverContainer";

/** Menu-bar popover (360 px wide): the idle-return card sits above today's totals. */
export function PopoverApp() {
  useEscapeToHide();
  return (
    <div className="h-full w-full">
      <TrackingPopoverContainer notice={<IdlePromptContainer />} />
    </div>
  );
}
