import { en, type Messages } from "@/shared/i18n/en";
import { describeError, IpcError } from "@/shared/ipc";

/** Outcome of a save: `null` on success, otherwise a message and, when known, the field at fault. */
export type SubmitResult = null | { field?: "pattern"; message: string };

export type Submit<T> = (value: T) => Promise<SubmitResult>;

/** Turns a thrown backend error into form feedback. An invalid regex belongs to the pattern field (R9.4). */
export function toSubmitResult(error: unknown, t: Messages = en): Exclude<SubmitResult, null> {
  if (error instanceof IpcError) {
    const message = describeError(error.error, t);
    return error.error.kind === "invalid_pattern" ? { field: "pattern", message } : { message };
  }
  return { message: error instanceof Error ? error.message : t.common.somethingWentWrong };
}
