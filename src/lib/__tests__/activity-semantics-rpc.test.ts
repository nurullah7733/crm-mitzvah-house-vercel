import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../supabase/migrations/20260829000300_fix_interaction_note_lookup.sql", import.meta.url), "utf8");
const generatedTypes = readFileSync(new URL("../../integrations/supabase/types.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url), "utf8");

describe("M2-F transactional activity persistence", () => {
  it("uses a concurrency-safe registration insert", () => {
    expect(sql).toContain("ON CONFLICT (event_id, person_id) DO NOTHING");
    expect(sql).toContain("FOR UPDATE");
  });
  it("preserves blank repeats and rejects changed payments", () => {
    expect(sql).toContain("WHEN payment_amount IS NULL THEN v_incoming_payment");
    expect(sql).toContain("Registration payment conflict");
  });
  it("resolves campaign creation inside the activity transaction", () => {
    const campaignBlock = sql.slice(sql.indexOf("v_campaign_name :="), sql.indexOf("SELECT id INTO v_donation_id"));
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("INSERT INTO public.campaigns");
    expect(campaignBlock).not.toContain("deleted_at");
    const campaignType = generatedTypes.slice(generatedTypes.indexOf("campaigns: {"), generatedTypes.indexOf("contact_methods: {"));
    expect(campaignType).not.toContain("deleted_at");
    expect(sql.indexOf("INSERT INTO public.campaigns")).toBeLessThan(sql.indexOf("INSERT INTO public.donations"));
  });
  it("stores optional external transaction references", () => {
    expect(sql).toContain("external_transaction_id");
  });
  it("deduplicates notes without inventing interaction soft-delete semantics", () => {
    const noteBlock = sql.slice(sql.indexOf("IF _note IS NOT NULL"), sql.indexOf("v_first :="));
    expect(noteBlock).toContain("INSERT INTO public.interactions");
    expect(noteBlock).toContain("WHERE NOT EXISTS");
    expect(noteBlock).toContain("person_id = _person_id");
    expect(noteBlock).toContain("date = (_note->>'date')::date");
    expect(noteBlock).toContain("text = _note->>'text'");
    expect(noteBlock).not.toContain("deleted_at");
  });
  it("never uses campaign text as an event candidate", () => {
    const fileEvents = importer.slice(importer.indexOf("const fileEvents"), importer.indexOf("const unansweredEvents"));
    expect(fileEvents).toContain("a.values.event_name");
    expect(fileEvents).not.toContain("a.values.campaign");
  });
});
