import { en, type Messages } from "@/shared/i18n/en";
import { shortcutReason } from "@/shared/lib/shortcut";

import type { AppError } from "./bindings";

/** Result shape produced by the generated `typedError` wrapper. */
export type IpcResult<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** A backend command failed with a typed `AppError`. */
export class IpcError extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(describeError(error));
    this.name = "IpcError";
    this.error = error;
  }
}

/** Unwraps a generated command result: data on success, a thrown `IpcError` otherwise. */
export async function unwrap<T>(result: Promise<IpcResult<T>>): Promise<T> {
  const settled = await result;
  if (settled.status === "error") throw new IpcError(settled.error);
  return settled.data;
}

/**
 * Human readable message for an `AppError` in the active language (`useT()`). English is the
 * default, which is also what `IpcError.message` carries.
 */
export function describeError(error: AppError, t: Messages = en): string {
  const m = t.errors;
  switch (error.kind) {
    case "invalid_pattern":
      return m.invalidPattern(error.pattern, error.reason);
    case "shortcut_unavailable":
      return m.shortcutUnavailable(error.shortcut, shortcutReason(error.reason, t));
    case "permission_denied":
      return m.permissionDenied;
    case "focus_unavailable":
      return m.focusUnavailable;
    case "ai_not_enabled":
      return m.aiNotEnabled;
    case "ai_key_missing":
      return m.aiKeyMissing;
    case "secret_store_unavailable":
      return m.secretStoreUnavailable(error.reason);
    case "not_found":
      return m.notFound;
    case "confirmation_required":
      return m.confirmationRequired;
    case "storage":
    case "invalid":
    case "internal":
    case "ai":
      // Free-form text from the backend: shown as it comes.
      return error.message;
  }
}

/** Message for any thrown value coming out of a query or mutation. */
export function errorMessage(error: unknown, t: Messages = en): string {
  if (error instanceof IpcError) return describeError(error.error, t);
  if (error instanceof Error) return error.message;
  return t.common.somethingWentWrong;
}
