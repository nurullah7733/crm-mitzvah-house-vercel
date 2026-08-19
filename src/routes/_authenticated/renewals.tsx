import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, currency, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { downloadCsv, stamp } from "@/lib/csv";
import { logChange } from "@/lib/session-log";
import {
  RENEWAL_LABELS,
  renewalTaskText,
  useRenewalDonors,
  useRenewalSettings,
  type RenewalDonor,
  type RenewalMode,
} from "@/lib/renewal";
import { RouteError } from "@/components/RouteError";
import { showError } from "@/lib/app-errors";

const MODES: RenewalMode[] = ["lapsed", "lybunt", "sybunt"];

export const Route = createFileRoute("/_authenticated/renewals")({
  head: () => ({
    meta: [
      { title: "Renewal outreach | Mitzvah House CRM" },
      {
        name: "description",
        content:
          "Donors who gave in a past year but not yet this year — with LYBUNT and SYBUNT views, follow-up calls and a mail-ready export.",
      },
      { property: "og:title", content: "Renewal outreach | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Reconnect with donors who gave before but not yet this year.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: RouteError,
  component: RenewalsPage,
});

function RenewalsPage() {
  const [mode, setMode] = useState<RenewalMode>("lapsed");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const { data: settings } = useRenewalSettings();
  const { data: donors, isLoading } = useRenewalDonors(mode);
  const queryClient = useQueryClient();

  const rows = donors ?? [];
  const chosen = useMemo(() => rows.filter((r) => selected[r.person_id]), [rows, selected]);
  const allChecked = rows.length > 0 && chosen.length === rows.length;

  const createTasks = useMutation({
    mutationFn: async (list: RenewalDonor[]) => {
      const due = new Date();
      due.setDate(due.getDate() + 14);
      const { error } = await supabase.from("tasks").insert(
        list.map((d) => ({
          person_id: d.person_id,
          text: renewalTaskText(d),
          owner: d.owner,
          due_date: due.toISOString().slice(0, 10),
          priority: d.prior_years >= 3 ? "High" : "Normal",
          status: "upcoming",
          notes: `Renewal outreach · ${d.prior_years} prior ${d.prior_years === 1 ? "year" : "years"} of giving · ${currency(
            d.lifetime_total,
          )} lifetime`,
        })),
      );
      if (error) throw error;
      return list.length;
    },
    onSuccess: (n) => {
      logChange(`Created ${n} renewal follow-up ${n === 1 ? "task" : "tasks"}`);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setSelected({});
      toast.success(
        `${n} renewal ${n === 1 ? "call" : "calls"} added to Tasks, assigned to the relationship owner`,
      );
    },
    onError: (e: unknown) => void showError(e, "Could not create the follow-up tasks"),
  });

  function exportCsv() {
    const list = chosen.length > 0 ? chosen : rows;
    if (list.length === 0) return;
    downloadCsv(
      `renewal-appeal-${mode}-${stamp()}`,
      list.map((d) => ({
        Name: d.name ?? "",
        "Relationship owner": d.owner ?? "",
        Email: d.email ?? "",
        Phone: d.phone ?? "",
        "Last gift amount": d.last_gift_amount ?? "",
        "Last gift date": d.last_gift_date ?? "",
        "Years they gave": d.prior_years,
        "Lifetime giving": d.lifetime_total,
        "Gave last year": d.gave_last_year ? "Yes" : "No",
      })),
    );
    toast.success("Renewal appeal list downloaded");
  }

  return (
    <AppShell
      title="Renewal outreach"
      subtitle="Donors who gave in a past year and haven't given yet this year — time to reconnect"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setSelected({});
              }}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                mode === m
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {RENEWAL_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Looking through the gift history…"
              : `${rows.length} ${rows.length === 1 ? "donor" : "donors"} to invite back${
                  settings && settings.min_total_giving > 0
                    ? ` · including gifts from ${currency(settings.min_total_giving)} lifetime and up`
                    : ""
                }`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="mr-2 size-4" />
              Export list
            </Button>
            <Button
              onClick={() => createTasks.mutate(chosen.length > 0 ? chosen : rows)}
              disabled={rows.length === 0 || createTasks.isPending}
            >
              <HeartHandshake className="mr-2 size-4" />
              {chosen.length > 0
                ? `Create ${chosen.length} calls`
                : "Create call tasks"}
            </Button>
          </div>
        </div>

        <section className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={(v) =>
                      setSelected(v ? Object.fromEntries(rows.map((r) => [r.person_id, true])) : {})
                    }
                    aria-label="Select everyone"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Last gift</th>
                <th className="px-4 py-3 font-medium">Lifetime giving</th>
                <th className="px-4 py-3 font-medium">Years they gave</th>
                <th className="px-4 py-3 font-medium">Relationship owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.person_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={!!selected[d.person_id]}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [d.person_id]: !!v }))}
                      aria-label={`Select ${d.name ?? "contact"}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/people/$personId"
                      params={{ personId: d.person_id }}
                      className="text-primary hover:underline"
                    >
                      {d.name ?? "Unnamed contact"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-money">
                      {d.last_gift_amount === null ? "—" : currency(d.last_gift_amount)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(d.last_gift_date)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-money">{currency(d.lifetime_total)}</td>
                  <td className="px-4 py-3">
                    {d.prior_years} {d.prior_years === 1 ? "year" : "years"}
                    {d.gave_last_year ? (
                      <span className="block text-xs text-muted-foreground">
                        including last year
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{d.owner ?? "Unassigned"}</td>
                </tr>
              ))}
              {isLoading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                    Looking through the gift history…
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                    Everyone who gave before has already given this year. Wonderful.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  );
}
