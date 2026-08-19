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
  FileBadge,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStaff } from "@/lib/current-staff";
import { showError } from "@/lib/app-errors";
import logoAsset from "@/assets/mitzvah-house-logo.png.asset.json";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/people", label: "People", icon: Users },
  { to: "/households", label: "Households", icon: Home },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/donations", label: "Donations", icon: HandCoins },
  { to: "/grants", label: "Grants", icon: FileBadge },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
] as const;

const SETTINGS = { to: "/settings", label: "Settings", icon: SettingsIcon } as const;
const INBOX = { to: "/inbox", label: "Inbox", icon: InboxIcon } as const;
const MENU_NAV = [...NAV, INBOX, SETTINGS] as const;

/* Only three fit a phone tab bar with a legible label — the rest live in the hamburger menu. */
const TAB_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/people", label: "People", icon: Users },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
] as const;

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
  useCurrentStaff();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    const { error } = await supabase.auth.signOut();
    if (error)
      await showError(error, {
        area: "auth",
        action: "Sign out",
        fallback: "Signing out didn't finish.",
      });
    navigate({ to: "/auth", replace: true });
  }

  const navLink =
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-primary-foreground/80 transition hover:bg-white/10 hover:text-primary-foreground";

  return (
    <div className="min-h-screen bg-background">
      {/* Brand header — azure, stuck to the top of every page */}
      <header className="sticky top-0 z-30 bg-[linear-gradient(120deg,var(--sidebar),var(--sidebar-accent))] shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3 sm:px-8">
          <Link to="/dashboard" className="flex shrink-0 items-center pr-2">
            <img src={logoAsset.url} alt="Mitzvah House" className="h-8 w-auto sm:h-9" />
          </Link>
          <form
            className="relative min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ to: "/search", search: { q: search } });
            }}
          >
            <Sparkles className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-suggestion" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ask about a household, event, or person…"
              aria-label="Search"
              className="w-full rounded-full border border-white/30 bg-white/95 py-2.5 pl-11 pr-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-white"
            />
          </form>
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Open menu"
              className="flex size-11 items-center justify-center rounded-xl border border-white/30 text-primary-foreground transition hover:bg-white/15"
            >
              <Menu className="size-5" />
            </button>
            {menuOpen && (
              <>
                <button
                  className="fixed inset-0 z-30 cursor-default"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-lg">
                  {MENU_NAV.map(({ to, label, icon: Icon }) => (
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
      </header>

      {/* Desktop sidebar — starts at the very top and tucks under the sticky
          header, so no white seam can appear if the header height changes. */}
      <aside className="fixed bottom-0 left-0 top-0 hidden w-60 flex-col bg-[linear-gradient(180deg,var(--sidebar),var(--sidebar-accent))] px-4 pb-6 pt-[5.5rem] lg:flex">
        <nav className="flex flex-1 flex-col gap-1">
          {[...NAV, INBOX].map(({ to, label, icon: Icon }) => (
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
        <div className="border-b border-border bg-card px-5 py-4 sm:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <h1 className="font-heading text-xl font-semibold text-foreground sm:text-2xl">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
              {action ? (
                /* Header actions always wrap — including any wrapper a page
                   passes in — so a label is never pushed off a narrow screen. */
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end [&>*]:min-h-11 sm:[&>*]:min-h-9 [&>div]:flex [&>div]:flex-wrap [&>div]:gap-2">
                  {action}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-5xl px-5 pb-28 pt-6 sm:px-8 lg:pb-12">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-border bg-card px-2 py-2 lg:hidden">
        {TAB_NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-xs font-medium text-muted-foreground"
            activeProps={{ className: "!text-primary font-medium bg-primary/10" }}
          >
            <Icon className="size-5" />
            <span className="whitespace-nowrap">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground sm:p-10">
      <p>{label}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}

/** One loading placeholder for every screen, so waiting always looks the same. */
export function LoadingState({ what }: { what: string }) {
  return <EmptyState label={`Loading ${what}…`} />;
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
  const parts = value.slice(0, 10).split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const date = y && m && d ? new Date(y, m - 1, d) : new Date(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.slice(0, 10).split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (!y || !m || !d) return null;
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date();
  return Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - then) / 86400000,
  );
}
