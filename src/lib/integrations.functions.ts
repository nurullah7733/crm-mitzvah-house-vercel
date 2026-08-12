// Server functions for the Settings > Integrations panel.
// Thin wrappers only — all logic lives inside each handler body.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IntegrationStatus =
  | "connected"
  | "needs_attention"
  | "awaiting_authorisation"
  | "not_connected";

export type IntegrationStatusEntry = {
  key: string;
  name: string;
  purpose: string;
  hasCredentials: boolean;
  maskedHint: string | null;
  lastEvent: { ok: boolean; kind: string; message: string | null; created_at: string } | null;
  status: IntegrationStatus;
};

const PROVIDERS: Record<string, { name: string; purpose: string; primaryKeyField: string }> = {
  donorbox: { name: "Donorbox", purpose: "Online donation forms and recurring gifts.", primaryKeyField: "api_key" },
  stripe: { name: "Stripe", purpose: "Card processing for online gifts.", primaryKeyField: "secret_key" },
  constant_contact: { name: "Constant Contact", purpose: "Email newsletters and campaigns.", primaryKeyField: "client_secret" },
  wordpress: { name: "WordPress", purpose: "Website donation and contact forms.", primaryKeyField: "webhook_secret" },
  cognito_forms: { name: "Cognito Forms", purpose: "Event registration and intake forms.", primaryKeyField: "webhook_secret" },
  quickbooks: { name: "QuickBooks", purpose: "Accounting and financial reporting.", primaryKeyField: "client_secret" },
  google_sheets: { name: "Google Sheets", purpose: "Spreadsheet imports and exports.", primaryKeyField: "webhook_secret" },
};

const NO_KEY_PROVIDERS = new Set(["wordpress", "cognito_forms", "google_sheets"]);
const OAUTH_PROVIDERS = new Set(["constant_contact", "quickbooks"]);

function maskHint(credentials: Record<string, string> | null | undefined, primaryKeyField: string): string | null {
  const value = credentials?.[primaryKeyField];
  if (!value) return null;
  const tail = value.slice(-4);
  return tail ? `•••• ${tail}` : null;
}

function deriveStatus(
  provider: string,
  hasCredentials: boolean,
  lastEvent: { ok: boolean; kind: string } | null,
): IntegrationStatus {
  if (!hasCredentials) return "not_connected";
  if (OAUTH_PROVIDERS.has(provider)) {
    if (lastEvent?.kind === "test" && lastEvent.ok) return "connected";
    return "awaiting_authorisation";
  }
  if (NO_KEY_PROVIDERS.has(provider)) return "connected";
  if (lastEvent?.kind === "test") return lastEvent.ok ? "connected" : "needs_attention";
  return "awaiting_authorisation";
}

async function syncPublicIntegrationsRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  displayName: string,
  status: IntegrationStatus,
) {
  const mapped = status === "connected" ? "connected" : status === "needs_attention" ? "needs_attention" : "not_connected";
  try {
    await admin
      .from("integrations")
      .update({ status: mapped, last_sync_at: mapped === "connected" ? new Date().toISOString() : null })
      .ilike("name", displayName);
  } catch {
    // Best-effort sync only — the integration_credentials table is the source of truth.
  }
}

async function buildStatusEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  key: string,
): Promise<IntegrationStatusEntry> {
  const meta = PROVIDERS[key];
  const { data: credRow } = await admin
    .from("integration_credentials")
    .select("credentials")
    .eq("provider", key)
    .maybeSingle();
  const credentials = (credRow?.credentials ?? null) as Record<string, string> | null;
  const hasCredentials = !!credentials && Object.keys(credentials).length > 0;

  const { data: eventRow } = await admin
    .from("integration_events")
    .select("kind, ok, message, created_at")
    .eq("provider", key)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastEvent = eventRow
    ? { ok: !!eventRow.ok, kind: eventRow.kind as string, message: (eventRow.message as string) ?? null, created_at: eventRow.created_at as string }
    : null;

  return {
    key,
    name: meta.name,
    purpose: meta.purpose,
    hasCredentials,
    maskedHint: maskHint(credentials, meta.primaryKeyField),
    lastEvent,
    status: deriveStatus(key, hasCredentials, lastEvent),
  };
}

export const listIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<IntegrationStatusEntry[]> => {
    // integration_credentials/integration_events are service-role only, no generated types yet.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    return Promise.all(Object.keys(PROVIDERS).map((key) => buildStatusEntry(admin, key)));
  });

export const saveIntegrationCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      provider: z.string(),
      credentials: z.record(z.string(), z.string()),
    }),
  )
  .handler(async ({ data }): Promise<IntegrationStatusEntry> => {
    const meta = PROVIDERS[data.provider];
    if (!meta) throw new Error("Unknown integration provider.");

    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.credentials)) {
      const trimmed = (v ?? "").trim();
      if (trimmed) cleaned[k] = trimmed;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    await admin
      .from("integration_credentials")
      .upsert({ provider: data.provider, credentials: cleaned, updated_at: new Date().toISOString() }, { onConflict: "provider" });

    await admin.from("integration_events").insert({
      provider: data.provider,
      kind: "saved",
      ok: true,
      message: "Credentials saved.",
    });

    const entry = await buildStatusEntry(admin, data.provider);
    await syncPublicIntegrationsRow(admin, meta.name, entry.status);
    return entry;
  });

export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ provider: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const meta = PROVIDERS[data.provider];
    if (!meta) throw new Error("Unknown integration provider.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: credRow } = await admin
      .from("integration_credentials")
      .select("credentials")
      .eq("provider", data.provider)
      .maybeSingle();
    const credentials = (credRow?.credentials ?? {}) as Record<string, string>;

    let result: { ok: boolean; message: string };

    if (data.provider === "stripe") {
      if (!credentials.secret_key) {
        result = { ok: false, message: "No secret key saved yet." };
      } else {
        try {
          const res = await fetch("https://api.stripe.com/v1/balance", {
            headers: { Authorization: `Bearer ${credentials.secret_key}` },
          });
          result = res.ok
            ? { ok: true, message: "Connected — Stripe accepted the secret key." }
            : { ok: false, message: `Stripe rejected the secret key (status ${res.status}).` };
        } catch {
          result = { ok: false, message: "Could not reach Stripe. Check your internet connection and try again." };
        }
      }
    } else if (data.provider === "donorbox") {
      if (!credentials.email || !credentials.api_key) {
        result = { ok: false, message: "Account email and API key are both required." };
      } else {
        try {
          const basic = Buffer.from(`${credentials.email}:${credentials.api_key}`).toString("base64");
          const res = await fetch("https://donorbox.org/api/v1/campaigns?page=1&per_page=1", {
            headers: { Authorization: `Basic ${basic}` },
          });
          result = res.ok
            ? { ok: true, message: "Connected — Donorbox accepted the credentials." }
            : { ok: false, message: `Donorbox rejected the credentials (status ${res.status}).` };
        } catch {
          result = { ok: false, message: "Could not reach Donorbox. Check your internet connection and try again." };
        }
      }
    } else if (OAUTH_PROVIDERS.has(data.provider)) {
      const hasCreds = Object.keys(credentials).length > 0;
      result = hasCreds
        ? {
            ok: false,
            message: `${meta.name} credentials are stored, but this connection needs to be authorised by ${meta.name} before it can sync — that step isn't built yet.`,
          }
        : { ok: false, message: `Save ${meta.name} credentials first.` };
    } else {
      const hasCreds = Object.keys(credentials).length > 0;
      result = hasCreds
        ? { ok: true, message: `${meta.name} data arrives through the Import Center, not a live API call — this just confirms the webhook secret is saved.` }
        : { ok: false, message: "Nothing saved yet for this integration." };
    }

    await admin.from("integration_events").insert({
      provider: data.provider,
      kind: "test",
      ok: result.ok,
      message: result.message,
    });

    const entry = await buildStatusEntry(admin, data.provider);
    await syncPublicIntegrationsRow(admin, meta.name, entry.status);

    return result;
  });

export const disconnectIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ provider: z.string() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const meta = PROVIDERS[data.provider];
    if (!meta) throw new Error("Unknown integration provider.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    await admin.from("integration_credentials").delete().eq("provider", data.provider);
    await admin.from("integration_events").insert({
      provider: data.provider,
      kind: "disconnected",
      ok: true,
      message: "Credentials removed.",
    });

    await syncPublicIntegrationsRow(admin, meta.name, "not_connected");

    return { ok: true };
  });
