import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/set-password")({
  head: () => ({
    meta: [
      { title: "Set Your Password | Mitzvah House CRM" },
      {
        name: "description",
        content: "Finish setting up your Mitzvah House CRM staff account by choosing a password.",
      },
      { property: "og:title", content: "Set Your Password | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Finish setting up your Mitzvah House CRM staff account by choosing a password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetPasswordPage,
});

function SetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The invite link carries a one-time session in the URL; the Supabase client
  // picks it up on load, so we just wait for it to appear.
  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setReady(true);
    });
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (!cancelled) setReady(true);
        return;
      }
      // Some links arrive as a one-time code in the address instead of a
      // ready-made session; exchange it before giving up.
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { data: exchanged } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled && exchanged?.session) {
          setReady(true);
          return;
        }
      }
      if (!cancelled) setReady(false);
    })();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground">
            MH
          </div>
          <h1 className="mt-5 text-2xl text-foreground">Choose your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Only you ever see it. You'll use your email and this password to sign in.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {ready === false ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>
                This link has expired or has already been used. Ask a director to send you a fresh
                invite from Settings → Staff.
              </p>
              <Button className="h-12 w-full rounded-xl text-base" onClick={() => navigate({ to: "/auth" })}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  className="text-base"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Type it again</Label>
                <Input
                  id="confirm"
                  className="text-base"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={busy || ready === null}>
                {busy ? "Saving…" : "Save password and sign in"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}