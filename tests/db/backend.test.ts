import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Database-side rules — merging, giving totals, the duplicate-gift guard and the
 * thank-you timeline — verified against a real backend. Skipped unless a test
 * backend is configured; see ./README.md. Never point these at live data.
 */
const url = process.env["TEST_SUPABASE_URL"];
const token = process.env["TEST_SUPABASE_ACCESS_TOKEN"];
const key = process.env["TEST_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
const configured = Boolean(url && token && key);

const tag = `vitest-${Date.now()}`;
const year = new Date().getFullYear();

describe.skipIf(!configured)("database rules", () => {
  const db = configured
    ? createClient(url!, key!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : (null as never);

  const created: { people: string[]; events: string[] } = { people: [], events: [] };

  async function addPerson(first: string, over: Record<string, unknown> = {}) {
    const { data, error } = await db
      .from("people")
      .insert({ first_name: first, last_name: tag, contact_type: "individual", role: "Adult", ...over })
      .select("id")
      .single();
    expect(error).toBeNull();
    created.people.push(data!.id);
    return data!.id as string;
  }

  async function addGift(personId: string, amount: number, date: string, over: Record<string, unknown> = {}) {
    const { data, error } = await db
      .from("donations")
      .insert({ person_id: personId, amount, date, source: tag, ...over })
      .select("id")
      .single();
    return { id: data?.id as string | undefined, error };
  }

  async function archiveGift(id: string) {
    const { error } = await db.rpc("archive_records", { _table: "donations", _ids: [id] });
    expect(error).toBeNull();
  }

  const totals = async (personId: string) => {
    const { data } = await db.from("people").select("lifetime_giving, this_year_giving").eq("id", personId).single();
    return { lifetime: Number(data!.lifetime_giving), thisYear: Number(data!.this_year_giving) };
  };

  beforeAll(() => {
    expect(configured).toBe(true);
  });

  afterAll(async () => {
    if (!configured) return;
    await db.from("donations").delete().eq("source", tag);
    for (const id of created.events) await db.from("events").delete().eq("id", id);
    for (const id of created.people) await db.from("people").delete().eq("id", id);
  });

  describe("giving totals", () => {
    it("adds up gifts, and counts only this calendar year in the this-year figure", async () => {
      const id = await addPerson("Totals");
      await addGift(id, 100, `${year}-02-01`);
      await addGift(id, 50, `${year - 1}-02-01`);
      const t = await totals(id);
      expect(t.lifetime).toBe(150);
      expect(t.thisYear).toBe(100);
    });

    it("excludes an archived (soft-deleted) gift from both totals", async () => {
      const id = await addPerson("Archived");
      const gift = await addGift(id, 80, `${year}-03-01`);
      expect((await totals(id)).lifetime).toBe(80);
      await archiveGift(gift.id!);
      const t = await totals(id);
      expect(t.lifetime).toBe(0);
      expect(t.thisYear).toBe(0);
    });
  });

  describe("duplicate gifts", () => {
    it("rejects a second identical gift for the same donor", async () => {
      const id = await addPerson("Dupe", { email: `dupe.${tag}@example.com` });
      const first = await addGift(id, 18, `${year}-04-01`);
      expect(first.error).toBeNull();
      const second = await addGift(id, 18, `${year}-04-01`);
      expect(second.error).not.toBeNull();
    });

    it("allows three separate $18 gifts on three different days", async () => {
      const id = await addPerson("Three", { email: `three.${tag}@example.com` });
      for (const d of ["05-01", "05-02", "05-03"]) {
        expect((await addGift(id, 18, `${year}-${d}`)).error).toBeNull();
      }
      expect((await totals(id)).lifetime).toBe(54);
    });
  });

  describe("merging two contacts", () => {
    it("keeps all history, the higher-status registration, and reconciles totals", async () => {
      const keep = await addPerson("Keep", { email: `keep.${tag}@example.com` });
      const dupe = await addPerson("Dupe2", { email: `dupe2.${tag}@example.com` });
      const { data: event } = await db
        .from("events")
        .insert({ name: `${tag} event`, date: `${year}-06-01` })
        .select("id")
        .single();
      created.events.push(event!.id);

      await addGift(keep, 100, `${year}-06-01`);
      await addGift(dupe, 25, `${year}-06-02`);
      await db.from("registrations").insert({ event_id: event!.id, person_id: keep, status: "registered" });
      await db.from("registrations").insert({ event_id: event!.id, person_id: dupe, status: "attended" });
      const task = await db.from("tasks").insert({ person_id: dupe, text: `${tag} follow up`, status: "upcoming" });
      expect(task.error).toBeNull();

      const { error } = await db.rpc("merge_people", { _surviving_id: keep, _merged_id: dupe, _field_values: {} });
      expect(error).toBeNull();

      const { data: gifts } = await db.from("donations").select("id").eq("person_id", keep).is("deleted_at", null);
      expect(gifts).toHaveLength(2);

      const { data: regs } = await db.from("registrations").select("status").eq("event_id", event!.id);
      expect(regs).toHaveLength(1);
      expect(regs![0]!.status).toBe("attended"); // the stronger status wins

      const { data: tasks } = await db.from("tasks").select("id").eq("person_id", keep);
      expect(tasks!.length).toBeGreaterThanOrEqual(1);

      expect((await totals(keep)).lifetime).toBe(125);

      const { data: gone } = await db.from("people").select("id").eq("id", dupe).maybeSingle();
      expect(gone).toBeNull();
    });
  });

  describe("thank-you letters are fully reversible", () => {
    it("unchecking clears the flag and removes the timeline entry it added", async () => {
      const id = await addPerson("Thanks", { email: `thanks.${tag}@example.com` });
      const gift = await addGift(id, 250, `${year}-07-01`);
      expect(gift.id).toBeTruthy();
      if (!gift.id) throw new Error("Test gift was not created");

      const markedResult = await db.rpc("mark_thank_you_sent", { _donation_id: gift.id, _sent: true });
      expect(markedResult.error).toBeNull();
      const marked = await db
        .from("interactions")
        .select("id")
        .eq("source_id", gift.id)
        .eq("source_kind", "donation_thank_you");
      expect(marked.error).toBeNull();
      expect(marked.data!.length).toBe(1);

      const unmarkedResult = await db.rpc("mark_thank_you_sent", { _donation_id: gift.id, _sent: false });
      expect(unmarkedResult.error).toBeNull();
      const { data: donation } = await db
        .from("donations")
        .select("thank_you_sent, thank_you_sent_date")
        .eq("id", gift.id)
        .single();
      expect(donation!.thank_you_sent).toBe(false);
      expect(donation!.thank_you_sent_date).toBeNull();

      const after = await db
        .from("interactions")
        .select("id")
        .eq("source_id", gift.id)
        .eq("source_kind", "donation_thank_you");
      expect(after.data).toHaveLength(0); // no orphaned timeline entry
    });

    it("archiving a gift takes its timeline entries with it", async () => {
      const id = await addPerson("Archive2", { email: `archive2.${tag}@example.com` });
      const gift = await addGift(id, 75, `${year}-08-01`);
      await archiveGift(gift.id!);
      const { data } = await db.from("interactions").select("id").eq("source_id", gift.id!);
      expect(data).toHaveLength(0);
    });

    it("tax receipt entries are created and removed with the checkbox state", async () => {
      const id = await addPerson("Receipt", { email: `receipt.${tag}@example.com` });
      const gift = await addGift(id, 180, `${year}-09-01`);
      expect(gift.id).toBeTruthy();
      if (!gift.id) throw new Error("Test gift was not created");

      const marked = await db.rpc("mark_receipt_sent", { _donation_id: gift.id, _sent: true });
      expect(marked.error).toBeNull();
      const created = await db
        .from("interactions")
        .select("id, person_id, type, source_kind")
        .eq("source_id", gift.id)
        .eq("source_kind", "donation_receipt");
      expect(created.error).toBeNull();
      expect(created.data).toMatchObject([{ person_id: id, type: "note", source_kind: "donation_receipt" }]);

      const unmarked = await db.rpc("mark_receipt_sent", { _donation_id: gift.id, _sent: false });
      expect(unmarked.error).toBeNull();
      const after = await db
        .from("interactions")
        .select("id")
        .eq("source_id", gift.id)
        .eq("source_kind", "donation_receipt");
      expect(after.error).toBeNull();
      expect(after.data).toHaveLength(0);
    });
  });
});
