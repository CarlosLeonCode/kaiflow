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

/** Human readable message for an `AppError` (UI copy, English). */
export function describeError(error: AppError): string {
  switch (error.kind) {
    case "invalid_pattern":
      return `The pattern "${error.pattern}" is not valid: ${error.reason}`;
    case "shortcut_unavailable":
      return `The shortcut ${error.shortcut} is unavailable: ${error.reason}`;
    case "permission_denied":
      return "Accessibility access is not granted.";
    case "focus_unavailable":
      return "Focus sessions need window tracking, which is unavailable right now.";
    case "ai_not_enabled":
      return "AI analysis is off for this provider. Switch it on in Settings > AI first.";
    case "ai_key_missing":
      return "No API key is saved for this provider. Add one in Settings > AI.";
    case "secret_store_unavailable":
      return `There is no secure place to keep API keys on this computer (${error.reason}). Keys are never stored in plain text, so this provider stays off.`;
    case "not_found":
      return "That item no longer exists.";
    case "confirmation_required":
      return "This action needs confirmation.";
    case "storage":
    case "invalid":
    case "internal":
    case "ai":
      return error.message;
  }
}

/** Message for any thrown value coming out of a query or mutation. */
export function errorMessage(error: unknown): string {
  if (error instanceof IpcError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
