import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { friendlyDbError } from "@/lib/db-errors";
import { logFailure } from "@/lib/app-errors";

/**
 * The one way a screen says "this didn't load". Plain language, always with a
 * way out — never a blank area that looks like there is simply no data.
 */
export function ErrorState({
  title = "This didn't load",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-urgent/30 bg-urgent/5 p-5 text-sm text-foreground shadow-sm"
    >
      <p className="flex items-center gap-2 font-heading font-semibold">
        <AlertTriangle className="size-4 text-urgent" />
        {title}
      </p>
      <p className="mt-1 text-muted-foreground">
        {message || "Something went wrong reading the database. Nothing was changed."}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={onRetry}>
          <RefreshCw className="size-4" /> Try again
        </Button>
      )}
    </div>
  );
}

/** Inline banner for a list that loaded partly, or a failure above existing content. */
export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return <ErrorState title="Some information didn't load" message={message} onRetry={onRetry} />;
}

/**
 * Drop-in for any screen backed by a query: renders nothing while things are
 * fine, and a plain-language, retryable message when a read fails.
 */
export function QueryError({
  error,
  what,
  onRetry,
}: {
  error: unknown;
  /** What didn't load, in the staff member's words: "the people list". */
  what: string;
  onRetry?: (() => void) | undefined;
}) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!error) {
      setMessage(null);
      return;
    }
    let live = true;
    void friendlyDbError(error, `We couldn't load ${what}.`).then((why) => {
      if (live) setMessage(why);
    });
    logFailure(error, { area: "read", action: `Load ${what}` });
    return () => {
      live = false;
    };
  }, [error, what]);

  if (!error) return null;
  return (
    <div className="mt-5">
      <ErrorState
        title={`We couldn't load ${what}`}
        message={message ?? "Check the internet connection and try again. Nothing was changed."}
        {...(onRetry ? { onRetry } : {})}
      />
    </div>
  );
}
