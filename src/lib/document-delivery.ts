import { supabase } from "@/integrations/supabase/client";
import { renderDocumentsHtml, type GeneratedDocument } from "@/lib/documents";

/**
 * Document DELIVERY, deliberately separate from generation.
 *
 * Today only "printed" is available. Email, text and Constant Contact are
 * declared here as channels that are not wired up yet — adding one means
 * filling in its `send` function and flipping `available` to true. Nothing
 * else in the app needs to change: every issued document already carries a
 * delivery_method and delivery_status.
 */
export const DELIVERY_METHODS = ["printed", "email", "text", "constant_contact"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export type DeliveryStatus = "pending" | "delivered" | "failed";

export type DeliveryResult = { status: DeliveryStatus; note?: string | null };

export type DeliveryChannel = {
  method: DeliveryMethod;
  label: string;
  available: boolean;
  /** Hand the finished documents to this channel. */
  send: (docs: GeneratedDocument[], heading: string) => Promise<DeliveryResult>;
};

/** Open the print dialog with the generated pages. */
export function printDocuments(docs: GeneratedDocument[], heading: string): boolean {
  if (typeof window === "undefined" || docs.length === 0) return false;
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;
  win.document.write(renderDocumentsHtml(docs, heading));
  win.document.close();
  win.focus();
  // Give the browser a beat to lay the page out before the print dialog.
  window.setTimeout(() => {
    try {
      win.print();
    } catch {
      /* the staff member can still use the browser's own print button */
    }
  }, 350);
  return true;
}

const notWired = (label: string): DeliveryChannel["send"] => async () => ({
  status: "pending" as DeliveryStatus,
  note: `${label} delivery is not connected yet`,
});

export const DELIVERY_CHANNELS: Record<DeliveryMethod, DeliveryChannel> = {
  printed: {
    method: "printed",
    label: "Print or save as PDF",
    available: true,
    send: async (docs, heading) =>
      printDocuments(docs, heading)
        ? { status: "delivered" }
        : { status: "failed", note: "The print window was blocked by the browser" },
  },
  email: { method: "email", label: "Email", available: false, send: notWired("Email") },
  text: { method: "text", label: "Text message", available: false, send: notWired("Text") },
  constant_contact: {
    method: "constant_contact",
    label: "Constant Contact",
    available: false,
    send: notWired("Constant Contact"),
  },
};

export function deliveryLabel(method: string): string {
  return DELIVERY_CHANNELS[method as DeliveryMethod]?.label ?? method;
}

/** Persist how a document went out. Kept apart from issuing it. */
export async function recordDelivery(args: {
  documentId: string;
  method: DeliveryMethod;
  status: DeliveryStatus;
  note?: string | null;
}) {
  const note = args.note?.trim();
  const { error } = await supabase.rpc("record_document_delivery", {
    _document_id: args.documentId,
    _delivery_method: args.method,
    _delivery_status: args.status,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
}

/** Generate-then-deliver in one step, recording the outcome per document. */
export async function deliverDocuments(args: {
  documentIds: string[];
  docs: GeneratedDocument[];
  heading: string;
  method: DeliveryMethod;
}): Promise<DeliveryResult> {
  const channel = DELIVERY_CHANNELS[args.method];
  const result = await channel.send(args.docs, args.heading);
  for (const id of args.documentIds) {
    await recordDelivery({
      documentId: id,
      method: args.method,
      status: result.status,
      note: result.note ?? null,
    });
  }
  return result;
}