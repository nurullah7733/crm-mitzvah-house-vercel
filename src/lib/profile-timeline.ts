type TimelineInteraction = {
  source_kind: string | null;
};

const MIRRORED_SOURCE_KINDS = new Set(["donation_gift", "event_attendance"]);

/** Keep staff activity and follow-up entries, while hiding rows already rendered from source records. */
export function shouldShowProfileInteraction(interaction: TimelineInteraction): boolean {
  return !interaction.source_kind || !MIRRORED_SOURCE_KINDS.has(interaction.source_kind);
}