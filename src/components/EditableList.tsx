import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ListTable = "met_source_options" | "program_options" | "tag_options";

/** A simple add / rename / remove list backed by one of the option tables. */
export function EditableList({
  table,
  title,
  description,
  placeholder,
  category,
}: {
  table: ListTable;
  title: string;
  description: string;
  placeholder: string;
  category?: string;
}) {
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const queryKey = ["option-list", table, category ?? "all"];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      if (table === "tag_options" && category) {
        const { data, error } = await supabase
          .from("tag_options")
          .select("id, label")
          .eq("category", category)
          .order("label");
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from(table).select("id, label").order("label");
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const add = useMutation({
    mutationFn: async (label: string) => {
      if (table === "tag_options") {
        const { error } = await supabase.from("tag_options").insert({ label, category: category ?? "general" });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from(table).insert({ label });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewLabel("");
      refresh();
      toast.success("Added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const { error } = await supabase.from(table).update({ label }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-heading font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="mt-3 space-y-2">
        {(data ?? []).map((item) => (
          <div key={item.id} className="flex gap-2">
            <Input
              className="text-base"
              defaultValue={item.label}
              aria-label={`Rename ${item.label}`}
              onBlur={(e) => {
                const label = e.target.value.trim();
                if (label && label !== item.label) rename.mutate({ id: item.id, label });
              }}
            />
            <Button
              variant="outline"
              className="shrink-0 rounded-xl text-urgent"
              aria-label={`Remove ${item.label}`}
              onClick={() => remove.mutate(item.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {(data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          className="text-base"
          placeholder={placeholder}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <Button
          className="shrink-0 rounded-xl"
          disabled={!newLabel.trim()}
          onClick={() => add.mutate(newLabel.trim())}
        >
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </section>
  );
}