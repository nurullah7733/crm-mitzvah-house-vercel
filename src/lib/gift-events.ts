import { supabase } from "@/integrations/supabase/client";

/** An event close enough to a gift date that it might be where the gift was given. */
export type NearbyEvent = {
  id: string;
  name: string;
  date: string;
  program: string | null;
};

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Events on the gift's date, or a day either side — gifts are often entered the
 * morning after an event, so a one-day window catches the real-life case.
 */
export async function findEventsNearDate(date: string): Promise<NearbyEvent[]> {
  if (!date) return [];
  const { data, error } = await supabase
    .from("events")
    .select("id, name, date, program")
    .is("deleted_at", null)
    .gte("date", shift(date, -1))
    .lte("date", shift(date, 1))
    .order("date");
  if (error) return [];
  return (data ?? []) as NearbyEvent[];
}

/** Was this person already marked as having attended? */
function isAttended(status: string | null | undefined) {
  return (status ?? "").trim().toLowerCase() === "attended";
}

/**
 * Attribute a gift to an event, and — only when staff confirm attendance —
 * record the attendance and the timeline entry. Everything here is idempotent:
 * nobody gets a second registration or a duplicate timeline line.
 */
export async function attributeGiftToEvent({
  donationId,
  personId,
  eventId,
  attended,
}: {
  donationId: string;
  personId: string;
  eventId: string;
  attended: boolean;
}) {
  const { data: event } = await supabase
    .from("events")
    .select("id, name, date, program")
    .eq("id", eventId)
    .maybeSingle();

  const patch: { event_id: string; campaign_id?: string; campaign?: string } = { event_id: eventId };

  // Default the designation to the event's own campaign, or failing that its
  // program, so an event gift stops reading as "General".
  const { data: gift } = await supabase
    .from("donations")
    .select("campaign_id, campaign")
    .eq("id", donationId)
    .maybeSingle();
  if (!gift?.campaign_id && !gift?.campaign) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("event_id", eventId)
      .limit(1)
      .maybeSingle();
    if (campaign) {
      patch.campaign_id = campaign.id;
      patch.campaign = campaign.name;
    } else if (event?.program) {
      patch.campaign = event.program;
    }
  }

  const { error } = await supabase.from("donations").update(patch).eq("id", donationId);
  if (error) throw error;

  if (!attended) return;
  await recordAttendance({ personId, eventId, eventName: event?.name ?? "an event", eventDate: event?.date ?? null });
}

/** Mark someone as having attended an event, without ever duplicating a record. */
export async function recordAttendance({
  personId,
  eventId,
  eventName,
  eventDate,
}: {
  personId: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
}) {
  const { data: existing } = await supabase
    .from("registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("person_id", personId)
    .limit(1);
  const row = existing?.[0];
  if (row) {
    if (!isAttended(row.status)) await supabase.from("registrations").update({ status: "Attended" }).eq("id", row.id);
  } else {
    await supabase.from("registrations").insert({ event_id: eventId, person_id: personId, status: "Attended" });
  }

  // The "Attended <event>" timeline entry is written by the database from the
  // registration, so unmarking attendance removes it again automatically.
}
