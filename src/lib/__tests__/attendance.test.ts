import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type Rows } from "@/lib/__tests__/fake-supabase";

/**
 * Regression cover for two reported bugs:
 *  - an RSVP staying on "registered" after the person clearly attended
 *  - a second registration or timeline line being created for the same person
 */

let fake = createFakeSupabase({});

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.client;
  },
}));

const { attributeGiftToEvent, findEventsNearDate, recordAttendance } =
  await import("@/lib/gift-events");
const { resetCampaignCache } = await import("@/lib/campaigns");

const world = (over: Partial<Rows> = {}): Rows => ({
  events: [
    {
      id: "e1",
      name: "Chanukah Dinner",
      date: "2026-12-10",
      program: "Chanukah",
      deleted_at: null,
    },
  ],
  donations: [
    {
      id: "d1",
      person_id: "p1",
      amount: 180,
      date: "2026-12-10",
      campaign_id: null,
      event_id: null,
    },
  ],
  campaigns: [],
  registrations: [],
  ...over,
});

beforeEach(() => {
  fake = createFakeSupabase(world());
  resetCampaignCache();
});

const registrations = () =>
  fake.tables["registrations"] as { id: string; person_id: string; status: string }[];

describe("recording attendance", () => {
  it("upgrades an existing RSVP from registered to attended", async () => {
    fake = createFakeSupabase(
      world({
        registrations: [{ id: "r1", event_id: "e1", person_id: "p1", status: "registered" }],
      }),
    );
    await recordAttendance({
      personId: "p1",
      eventId: "e1",
      eventName: "Chanukah Dinner",
      eventDate: "2026-12-10",
    });
    expect(registrations()).toHaveLength(1);
    expect(registrations()[0]!.status).toBe("attended");
  });

  it("upgrades a no_show as well", async () => {
    fake = createFakeSupabase(
      world({ registrations: [{ id: "r1", event_id: "e1", person_id: "p1", status: "no_show" }] }),
    );
    await recordAttendance({
      personId: "p1",
      eventId: "e1",
      eventName: "Chanukah Dinner",
      eventDate: "2026-12-10",
    });
    expect(registrations()[0]!.status).toBe("attended");
  });

  it("creates the registration when there wasn't one", async () => {
    await recordAttendance({
      personId: "p1",
      eventId: "e1",
      eventName: "Chanukah Dinner",
      eventDate: "2026-12-10",
    });
    expect(registrations()).toHaveLength(1);
    expect(registrations()[0]).toMatchObject({ person_id: "p1", status: "attended" });
  });

  it("is idempotent: running twice leaves one registration and writes nothing the second time", async () => {
    await recordAttendance({
      personId: "p1",
      eventId: "e1",
      eventName: "Chanukah Dinner",
      eventDate: "2026-12-10",
    });
    const writesAfterFirst = fake.writes.length;
    await recordAttendance({
      personId: "p1",
      eventId: "e1",
      eventName: "Chanukah Dinner",
      eventDate: "2026-12-10",
    });
    expect(registrations()).toHaveLength(1);
    expect(fake.writes.length).toBe(writesAfterFirst);
  });

  it("never touches another person's registration for the same event", async () => {
    fake = createFakeSupabase(
      world({
        registrations: [{ id: "r1", event_id: "e1", person_id: "p2", status: "registered" }],
      }),
    );
    await recordAttendance({
      personId: "p1",
      eventId: "e1",
      eventName: "Chanukah Dinner",
      eventDate: "2026-12-10",
    });
    expect(registrations()).toHaveLength(2);
    expect(registrations().find((r) => r.person_id === "p2")!.status).toBe("registered");
  });

  it("does not write a timeline entry itself — the database does, so unmarking removes it", async () => {
    await recordAttendance({
      personId: "p1",
      eventId: "e1",
      eventName: "Chanukah Dinner",
      eventDate: "2026-12-10",
    });
    expect(fake.writes.filter((w) => w.table === "interactions")).toHaveLength(0);
  });
});

describe("attributing a gift to an event", () => {
  it("links the gift and records attendance when staff confirm it", async () => {
    fake = createFakeSupabase(
      world({
        registrations: [{ id: "r1", event_id: "e1", person_id: "p1", status: "registered" }],
      }),
    );
    await attributeGiftToEvent({ donationId: "d1", personId: "p1", eventId: "e1", attended: true });
    const gift = (
      fake.tables["donations"] as { event_id: string | null; campaign_id: string | null }[]
    )[0]!;
    expect(gift.event_id).toBe("e1");
    // The event's program becomes a real campaign row, so the gift stops
    // reading as "General" without a second free-text copy of the name.
    expect(gift.campaign_id).toBeTruthy();
    expect(
      (fake.tables["campaigns"] as { id: string; name: string }[]).find(
        (c) => c.id === gift.campaign_id,
      )!.name,
    ).toBe("Chanukah");
    expect(registrations()[0]!.status).toBe("attended");
  });

  it("links the gift but leaves attendance alone when staff say they didn't attend", async () => {
    await attributeGiftToEvent({
      donationId: "d1",
      personId: "p1",
      eventId: "e1",
      attended: false,
    });
    expect((fake.tables["donations"] as { event_id: string | null }[])[0]!.event_id).toBe("e1");
    expect(registrations()).toHaveLength(0);
  });

  it("keeps a designation the gift already had", async () => {
    fake = createFakeSupabase(
      world({
        donations: [
          {
            id: "d1",
            person_id: "p1",
            amount: 180,
            date: "2026-12-10",
            campaign_id: "c9",
            event_id: null,
          },
        ],
        campaigns: [{ id: "c9", name: "Building Fund", event_id: null }],
      }),
    );
    await attributeGiftToEvent({
      donationId: "d1",
      personId: "p1",
      eventId: "e1",
      attended: false,
    });
    expect((fake.tables["donations"] as { campaign_id: string }[])[0]!.campaign_id).toBe("c9");
  });

  it("prefers the event's own campaign when there is one", async () => {
    fake = createFakeSupabase(
      world({ campaigns: [{ id: "c1", name: "Chanukah 2026", event_id: "e1" }] }),
    );
    await attributeGiftToEvent({
      donationId: "d1",
      personId: "p1",
      eventId: "e1",
      attended: false,
    });
    const gift = (fake.tables["donations"] as { campaign_id: string }[])[0]!;
    expect(gift.campaign_id).toBe("c1");
  });
});

describe("finding events near a gift date", () => {
  it("looks a day either side, because gifts get entered the morning after", async () => {
    for (const date of ["2026-12-09", "2026-12-10", "2026-12-11"]) {
      expect(await findEventsNearDate(date)).toHaveLength(1);
    }
    expect(await findEventsNearDate("2026-12-13")).toHaveLength(0);
  });

  it("returns nothing without a date instead of scanning every event", async () => {
    expect(await findEventsNearDate("")).toEqual([]);
  });
});
