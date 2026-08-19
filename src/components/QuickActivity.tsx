import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/lib/app-errors";
import { logChange } from "@/lib/session-log";

/** The one-tap activity buttons, editable in Settings > Lists & labels. */
export function useActivityOptions() {
  const { data } = useQuery({
    queryKey: ["option-list", "activity_options", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_options")
        .select("id, label")
        .order("label");
      if (error) throw error;
      return data ?? [];
    },
  });
  return (data ?? []).map((o) => o.label);
}

function chipClass(active: boolean) {
  return `min-h-11 rounded-xl border px-4 py-2.5 text-sm ${
    active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
  }`;
}

/** Multi-select activity chips for forms — nothing is written until the form saves. */
export function QuickActivityChips({
  selected,
  onChange,
  label = "What did you do here?",
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const options = useActivityOptions();
  if (options.length === 0) return null;
  const toggle = (a: string) =>
    onChange(selected.includes(a) ? selected.filter((x) => x !== a) : [...selected, a]);
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((a) => (
          <button key={a} type="button" onClick={() => toggle(a)} className={chipClass(selected.includes(a))}>
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Write the chosen activities onto a timeline, dated today. */
export async function logActivities(
  activities: string[],
  target: { personId?: string | undefined; householdId?: string | undefined },
) {
  if (activities.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("interactions").insert(
    activities.map((label) => ({
      person_id: target.personId ?? null,
      household_id: target.householdId ?? null,
      type: "note",
      date,
      text: label,
    })),
  );
  if (error) throw error;
}

/**
 * Profile version: each tap logs straight away, so a delivery is one tap
 * from a person's page. Multiple buttons can be tapped in a row.
 */
export function QuickActivityButtons({
  personId,
  householdId,
}: {
  personId?: string;
  householdId?: string;
}) {
  const options = useActivityOptions();
  const queryClient = useQueryClient();

  const log = useMutation({
    mutationFn: (label: string) => logActivities([label], { personId, householdId }),
    onSuccess: (_d, label) => {
      toast.success(`Logged: ${label}`);
      logChange(`Logged activity: ${label}`);
      void queryClient.invalidateQueries();
    },
    onError: (e: unknown) => void showError(e),
  });

  if (options.length === 0) return null;

  return (
    <div>
      <p className="text-xs text-muted-foreground">Log an activity — one tap, dated today</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((a) => (
          <button
            key={a}
            type="button"
            className={chipClass(false)}
            disabled={log.isPending}
            onClick={() => log.mutate(a)}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}
