import { useEffect } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logFailure } from "@/lib/app-errors";

/**
 * Every route uses this as its error boundary, so a crash inside a screen shows
 * a recoverable message instead of a blank white page — and gets recorded on the
 * server, not just in whoever's browser console it happened in.
 */
export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : "";

  useEffect(() => {
    logFailure(error, { area: "route", action: "Render a screen" });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg p-6">
      <div role="alert" className="rounded-2xl border border-urgent/30 bg-card p-6 shadow-sm">
        <p className="flex items-center gap-2 font-heading text-lg font-semibold">
          <AlertTriangle className="size-5 text-urgent" />
          This page ran into a problem
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing was lost. Try loading it again — if it keeps happening, it has been recorded so it
          can be looked at.
        </p>
        {message && (
          <p className="mt-3 rounded-xl bg-muted/60 p-3 font-mono text-xs text-muted-foreground">
            {message}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            className="gap-2"
            onClick={() => {
              reset?.();
              void router.invalidate();
            }}
          >
            <RefreshCw className="size-4" /> Try again
          </Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
