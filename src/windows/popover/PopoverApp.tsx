import { useFocusChime } from "@/features/focus/hooks/useFocusChime";
import { IdlePromptContainer } from "@/features/idle-prompt/containers/IdlePromptContainer";
import { UpdateBannerContainer } from "@/features/updates/containers/UpdateContainers";
import { useEscapeToHide } from "@/features/tracking/hooks/useEscapeToHide";
import { TrackingPopoverContainer } from "@/features/tracking/containers/TrackingPopoverContainer";

/** Menu-bar popover (360 px wide): the idle-return card sits above today's totals. */
export function PopoverApp() {
  useEscapeToHide();
  // The end of a block chimes here when no system notification could ring.
  useFocusChime();
  return (
    <div className="h-full w-full">
      <TrackingPopoverContainer notice={
          <>
            <IdlePromptContainer />
            <UpdateBannerContainer />
          </>
        } />
    </div>
  );
}
