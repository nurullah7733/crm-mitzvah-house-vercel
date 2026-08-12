import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Home,
  CalendarDays,
  HandCoins,
  ListChecks,
  Inbox as InboxIcon,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/people", label: "People", icon: Users },
  { to: "/households", label: "Households", icon: Home },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/donations", label: "Donations", icon: HandCoins },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
] as const;

const SETTINGS = { to: "/settings", label: "Settings", icon: SettingsIcon } as const;

export function AppShell({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navLink =
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-primary-foreground/80 transition hover:bg-white/10 hover:text-primary-foreground";

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-[linear-gradient(180deg,var(--sidebar),var(--sidebar-accent))] px-4 py-6 lg:flex">
        <div className="px-2">
          <p className="font-heading text-lg font-semibold text-primary-foreground">Mitzvah House</p>
          <p className="text-xs text-primary-foreground/70">Relationship CRM</p>
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={navLink}
              activeProps={{ className: "bg-white/15 !text-primary-foreground font-medium" }}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t border-white/15 pt-3">
          <Link
            to={SETTINGS.to}
            className={navLink}
            activeProps={{ className: "bg-white/15 !text-primary-foreground font-medium" }}
          >
            <SETTINGS.icon className="size-4 shrink-0" /> {SETTINGS.label}
          </Link>
          <button onClick={signOut} className={navLink}>
            <LogOut className="size-4 shrink-0" /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-5 py-3 backdrop-blur sm:px-8">
          <div className="mx-auto max-w-5xl">
            {/* Global search */}
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                navigate({ to: "/people", search: { q: search } });
              }}
            >
              <Sparkles className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-suggestion" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ask about a household, event, or person…"
                aria-label="Search"
                className="w-full rounded-full border border-border bg-background py-2.5 pl-11 pr-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
            </form>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0">
                <h1 className="truncate font-heading text-xl font-semibold text-foreground sm:text-2xl">{title}</h1>
                {subtitle ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {action}
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="Open menu"
                  >
                    <Menu className="size-4" />
                  </Button>
                  {menuOpen && (
                    <>
                      <button
                        className="fixed inset-0 z-30 cursor-default"
                        aria-label="Close menu"
                        onClick={() => setMenuOpen(false)}
                      />
                      <div className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-lg">
                        {[...NAV, SETTINGS].map(({ to, label, icon: Icon }) => (
                          <Link
                            key={to}
                            to={to}
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-foreground hover:bg-muted"
                            activeProps={{ className: "!text-primary font-medium bg-primary/10" }}
                          >
                            <Icon className="size-4" /> {label}
                          </Link>
                        ))}
                        <button
                          onClick={signOut}
                          className="mt-1 flex w-full items-center gap-2.5 rounded-xl border-t border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted"
                        >
                          <LogOut className="size-4" /> Sign out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-5 pb-28 pt-6 sm:px-8 lg:pb-12">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 flex overflow-x-auto border-t border-border bg-card px-1 py-2 lg:hidden">
        {[...NAV, SETTINGS].map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex min-w-[64px] flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1 text-[11px] text-muted-foreground"
            activeProps={{ className: "!text-primary font-medium bg-primary/10" }}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function initials(first?: string | null, last?: string | null) {
  return `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
}

export function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const date = y && m && d ? new Date(y, m - 1, d) : new Date(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y) return null;
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date();
  return Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - then) / 86400000);
}
