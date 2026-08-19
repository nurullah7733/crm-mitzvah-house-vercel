import { useState } from "react";
import { FileText, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  acknowledgmentFor,
  fetchGift,
  fetchYearGifts,
  groupByDonor,
  issueAcknowledgment,
  issueStatement,
  statementFor,
} from "@/lib/statements";
import { loadOrgSettings } from "@/lib/org-settings";
import { deliverDocuments } from "@/lib/document-delivery";
import { logAppError } from "@/lib/error-log";

/**
 * Buttons that turn gift records into printed paper.
 *
 * Generation and delivery stay apart: we build the document, record that it was
 * issued, then hand it to a delivery channel (only "printed" today).
 */
export function StatementButton({
  personId,
  taxYear,
  onDone,
}: {
  personId: string;
  taxYear: number;
  onDone?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const org = await loadOrgSettings();
      const groups = groupByDonor(await fetchYearGifts(taxYear, personId));
      const group = groups[0];
      if (!group) {
        toast.error(`No gifts recorded for this contact in ${taxYear}.`);
        return;
      }
      const documentId = await issueStatement(personId, taxYear);
      const result = await deliverDocuments({
        documentIds: [documentId],
        docs: [statementFor(group, taxYear, org)],
        heading: `${taxYear} tax statement`,
        method: "printed",
      });
      if (result.status === "delivered") {
        toast.success(`${taxYear} statement issued and sent to your printer.`);
      } else {
        toast.error(
          result.note ??
            "The statement was recorded, but the print window did not open. Allow pop-ups and print it again from the Statements screen.",
        );
      }
      await onDone?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`We could not produce that statement: ${message}`);
      void logAppError({ area: "statements", action: "issue_statement_profile", message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="min-h-11 rounded-xl"
      disabled={busy}
      onClick={run}
    >
      <FileText className="size-3.5" /> {taxYear} tax statement
    </Button>
  );
}

export function AcknowledgmentButton({
  donationId,
  onDone,
  label = "Thank-you letter",
}: {
  donationId: string;
  onDone?: () => void | Promise<void>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const org = await loadOrgSettings();
      const gift = await fetchGift(donationId);
      if (!gift) {
        toast.error("That gift is no longer available.");
        return;
      }
      const documentId = await issueAcknowledgment(donationId);
      const result = await deliverDocuments({
        documentIds: [documentId],
        docs: [acknowledgmentFor(gift, org)],
        heading: "Thank-you letter",
        method: "printed",
      });
      if (result.status === "delivered") {
        toast.success("Letter ready to print. The gift is marked as thanked.");
      } else {
        toast.error(
          result.note ??
            "The letter was recorded, but the print window did not open. Allow pop-ups and try again.",
        );
      }
      await onDone?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`We could not produce that letter: ${message}`);
      void logAppError({ area: "statements", action: "issue_acknowledgment", message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="min-h-9 rounded-xl"
      disabled={busy}
      onClick={run}
    >
      <Mail className="size-3.5" /> {label}
    </Button>
  );
}
