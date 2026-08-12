import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plug, ChevronDown, ChevronUp } from "lucide-react";
import { logChange } from "@/lib/session-log";
import { formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/fields";
import {
  listIntegrationStatus,
  saveIntegrationCredentials,
  testIntegration,
  disconnectIntegration,
  type IntegrationStatusEntry,
} from "@/lib/integrations.functions";
import { supabase } from "@/integrations/supabase/client";

type FieldDef = { key: string; label: string; secret?: boolean };

const PROVIDER_FIELDS: Record<string, FieldDef[]> = {
  stripe: [{ key: "secret_key", label: "Secret key", secret: true }],
  donorbox: [
    { key: "email", label: "Account email" },
    { key: "api_key", label: "API key", secret: true },
  ],
  constant_contact: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client secret", secret: true },
  ],
  quickbooks: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client secret", secret: true },
    { key: "realm_id", label: "Realm / company ID" },
  ],
  wordpress: [{ key: "webhook_secret", label: "Webhook secret (optional)", secret: true }],
  cognito_forms: [{ key: "webhook_secret", label: "Webhook secret (optional)", secret: true }],
  google_sheets: [{ key: "webhook_secret", label: "Webhook secret (optional)", secret: true }],
};

const PROVIDER_ORDER = [
  "donorbox",
  "stripe",
  "constant_contact",
  "wordpress",
  "cognito_forms",
  "quickbooks",
  "google_sheets",
];

async function authHeaders(): Promise<HeadersInit | undefined> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function StatusPill({ status }: { status: IntegrationStatusEntry["status"] }) {
  const map: Record<IntegrationStatusEntry["status"], { label: string; className: string }> = {
    connected: { label: "Connected", className: "bg-money text-money-foreground" },
    needs_attention: { label: "Needs attention", className: "bg-suggestion text-suggestion-foreground" },
    awaiting_authorisation: { label: "Awaiting authorisation", className: "bg-suggestion text-suggestion-foreground" },
    not_connected: { label: "Not connected", className: "bg-muted text-muted-foreground" },
  };
  const info = map[status];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${info.className}`}>
      {info.label}
    </span>
  );
}

export function IntegrationsPanel() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  const listFn = useServerFn(listIntegrationStatus);
  const saveFn = useServerFn(saveIntegrationCredentials);
  const testFn = useServerFn(testIntegration);
  const disconnectFn = useServerFn(disconnectIntegration);

  const { data, isLoading } = useQuery({
    queryKey: ["integration-status"],
    queryFn: async () => {
      const headers = await authHeaders();
      return listFn({ headers });
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["integration-status"] });

  const save = useMutation({
    mutationFn: async ({ provider, credentials }: { provider: string; credentials: Record<string, string> }) => {
      const headers = await authHeaders();
      return saveFn({ data: { provider, credentials }, headers });
    },
    onSuccess: (entry) => {
      invalidate();
      toast.success(`${entry.name} credentials saved`);
      logChange(`Saved ${entry.name} integration credentials`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async (provider: string) => {
      const headers = await authHeaders();
      return testFn({ data: { provider }, headers });
    },
    onSuccess: (result) => {
      invalidate();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: async (provider: string) => {
      const headers = await authHeaders();
      return disconnectFn({ data: { provider }, headers });
    },
    onSuccess: (_result, provider) => {
      invalidate();
      const meta = data?.find((d) => d.key === provider);
      toast.success(`${meta?.name ?? "Integration"} disconnected`);
      logChange(`Disconnected ${meta?.name ?? provider} integration`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAndTest = async (provider: string) => {
    const credentials = drafts[provider] ?? {};
    await save.mutateAsync({ provider, credentials });
    await test.mutateAsync(provider);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Plug className="size-4 text-primary" />
        <h2 className="font-heading font-semibold">Integrations</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Credentials are stored on the server and never shown back in full. Testing a connection confirms the key
        works, but automatic two-way syncing between these systems isn't built yet — data still comes in through the
        Import Center.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading integrations…</p>
      ) : (
        <div className="space-y-2">
          {PROVIDER_ORDER.map((key) => {
            const entry = data?.find((d) => d.key === key);
            if (!entry) return null;
            const isOpen = expanded === key;
            const fields = PROVIDER_FIELDS[key] ?? [];
            const draft = drafts[key] ?? {};

            return (
              <div key={key} className="rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{entry.name}</p>
                    <p className="text-xs text-muted-foreground">{entry.purpose}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={entry.status} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setExpanded(isOpen ? null : key)}
                    >
                      {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Last check: {entry.lastEvent ? formatDate(entry.lastEvent.created_at) : "never"}</span>
                  {entry.maskedHint && <span>Stored key: {entry.maskedHint}</span>}
                </div>
                {entry.lastEvent?.message && (
                  <p className="mt-1 text-xs text-foreground">{entry.lastEvent.message}</p>
                )}

                {isOpen && (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {fields.map((f) => (
                        <Field key={f.key} label={f.label}>
                          <Input
                            className="text-base"
                            type={f.secret ? "password" : "text"}
                            value={draft[f.key] ?? ""}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [key]: { ...prev[key], [f.key]: e.target.value },
                              }))
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="rounded-xl"
                        disabled={save.isPending || test.isPending}
                        onClick={() => saveAndTest(key)}
                      >
                        Save & test
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={test.isPending || !entry.hasCredentials}
                        onClick={() => test.mutate(key)}
                      >
                        Test connection
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={disconnect.isPending || !entry.hasCredentials}
                        onClick={() => disconnect.mutate(key)}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
