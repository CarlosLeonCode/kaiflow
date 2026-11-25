import type { FocusActiveDto, TrackingStateDto } from "@/shared/ipc";

import type { KaiPose } from "../components/Kai";

export interface KaiPoseInput {
  /** Today's ensō is full. */
  done: boolean;
  /** The running block (focus, timer or break), if any. */
  block: Pick<FocusActiveDto, "kind" | "paused_at"> | null;
  tracking: TrackingStateDto;
}

/**
 * Kai's pose in the popover, by priority: `done` once today's ensō is full, `rest` during a
 * break or while the block or tracking is paused or off, `focus` while a block runs, `hello`
 * otherwise. Timers count as blocks: they are time set aside for one thing.
 */
export function kaiPose({ done, block, tracking }: KaiPoseInput): KaiPose {
  if (done) return "done";
  if (block?.kind === "break") return "rest";
  if (block && block.paused_at !== null) return "rest";
  if (tracking === "paused" || tracking === "stopped") return "rest";
  if (block) return "focus";
  return "hello";
}
