// One place for "something failed" so no failure is silent: staff see a plain
// sentence, and the same failure is recorded on the server for later.
import { toast } from "sonner";
import { friendlyDbError } from "@/lib/db-errors";
import { reportAppError } from "@/lib/errors.functions";

export type FailureContext = {
  /** Which screen or feature — used when reading the log later. */
  area?: string;
  /** What the person was trying to do, in their words: "Save the person". */
  action?: string;
  /** Sentence to show when the error carries nothing useful. */
  fallback?: string;
};

function normalizeContext(context?: FailureContext | string): FailureContext {
  if (!context) return {};
  return typeof context === "string" ? { fallback: context, action: context } : context;
}

function technicalDetail(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}\n${e.stack ?? ""}`.trim();
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/** Fire-and-forget: never let logging a failure cause another failure. */
export function logFailure(e: unknown, context?: FailureContext | string, message?: string) {
  const ctx = normalizeContext(context);
  const payload = {
    message: (message ?? technicalDetail(e)).slice(0, 2000) || "Unknown failure",
    detail: technicalDetail(e).slice(0, 8000),
    ...(ctx.area ? { area: ctx.area } : {}),
    ...(ctx.action ? { action: ctx.action } : {}),
    ...(typeof window !== "undefined"
      ? {
          path: window.location.pathname + window.location.search,
          userAgent: window.navigator.userAgent,
        }
      : {}),
  };
  void (async () => {
    try {
      await reportAppError({ data: payload });
    } catch {
      /* offline or the log itself is down — the toast still tells the user */
    }
  })();
}

/**
 * Turn a failure into a sentence for staff. Shows a toast, records it on the
 * server, and returns the message so a screen can also keep it on the page.
 */
export async function showError(e: unknown, context?: FailureContext | string): Promise<string> {
  const ctx = normalizeContext(context);
  const message = await friendlyDbError(
    e,
    ctx.fallback ?? "That didn't save. Nothing was changed.",
  );
  toast.error(message);
  logFailure(e, ctx, message);
  return message;
}

/**
 * For a write whose result nothing else depends on (a timeline entry, a source
 * note, a follow-up task). Returns false when it failed, and tells the user.
 */
export async function guard<T>(
  work: PromiseLike<{ error: unknown; data?: T }>,
  context?: FailureContext | string,
): Promise<boolean> {
  const { error } = await work;
  if (!error) return true;
  await showError(error, context);
  return false;
}

/** Same, for a step that must stop the surrounding action when it fails. */
export async function must<T>(
  work: PromiseLike<{ error: unknown; data: T }>,
  whatFailed: string,
): Promise<T> {
  const { data, error } = await work;
  if (error) throw error;
  if (data === null || data === undefined)
    throw new Error(`${whatFailed} didn't come back from the database.`);
  return data;
}

/**
 * For a write the surrounding action depends on: raises so the caller's error
 * handler shows one plain sentence instead of the step passing unnoticed.
 */
export async function mustWrite(
  work: PromiseLike<{ error: { message?: string } | null }>,
  whatFailed: string,
): Promise<void> {
  const { error } = await work;
  if (error) throw new Error(`${whatFailed} ${error.message ?? ""}`.trim());
}
