import { supabase } from "@/integrations/supabase/client";
import { resolveCampaignId } from "@/lib/campaigns";

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
  importBatchId,
}: {
  donationId: string;
  personId: string;
  eventId: string;
  attended: boolean;
  importBatchId?: string | null;
}) {
  const { data: event } = await supabase
    .from("events")
    .select("id, name, date, program")
    .eq("id", eventId)
    .maybeSingle();

  const patch: { event_id: string; campaign_id?: string } = {
    event_id: eventId,
  };

  // Default the designation to the event's own campaign, or failing that its
  // program, so an event gift stops reading as "General".
  const { data: gift } = await supabase
    .from("donations")
    .select("campaign_id")
    .eq("id", donationId)
    .maybeSingle();
  if (!gift?.campaign_id) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("event_id", eventId)
      .limit(1)
      .maybeSingle();
    if (campaign) {
      patch.campaign_id = campaign.id;
    } else if (event?.program) {
      const programCampaign = await resolveCampaignId(event.program);
      if (programCampaign) patch.campaign_id = programCampaign;
    }
  }

  const { error } = await supabase.from("donations").update(patch).eq("id", donationId);
  if (error) throw error;

  if (!attended) return;
  await recordAttendance({
    personId,
    eventId,
    eventName: event?.name ?? "an event",
    eventDate: event?.date ?? null,
    ...(importBatchId !== undefined ? { importBatchId } : {}),
  });
}

/** Mark someone as having attended an event, without ever duplicating a record. */
export async function recordAttendance({
  personId,
  eventId,
  eventName,
  eventDate,
  importBatchId,
}: {
  personId: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  importBatchId?: string | null;
}) {
  const { data: existing } = await supabase
    .from("registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("person_id", personId)
    .limit(1);
  const row = existing?.[0];
  if (row) {
    // The stored statuses are lower-case ("registered" / "attended" / "no_show").
    if (!isAttended(row.status)) {
      const { error } = await supabase
        .from("registrations")
        .update({ status: "attended" })
        .eq("id", row.id);
      if (error) throw error;
    }
  } else {
    const { error } = await supabase.from("registrations").insert({
      event_id: eventId,
      person_id: personId,
      status: "attended",
      import_batch_id: importBatchId ?? null,
    });
    if (error) throw error;
  }

  // The "Attended <event>" timeline entry is written by the database from the
  // registration, so unmarking attendance removes it again automatically.
}
