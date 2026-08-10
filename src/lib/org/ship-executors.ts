// ---------------------------------------------------------------------------
// org/ship-executors.ts — what "ship" actually DOES, per department
//
// The owner's approve trigger (shipWorkOrder) calls executeShip.
//
// FINANCE: a deliverable may carry a ```payment fenced block — remittance
// matches the Bookkeeper proposed and Margot reviewed. Shipping applies them
// to Zoho Books as customer payments (marking invoices paid). This is the
// only write the hub makes to Books, and it happens ONLY on the owner's
// approval. Every entry is re-verified against the live invoice before
// posting: the invoice must exist, be unpaid, and the amount must not exceed
// its balance.
//
// Every other department ships as a plain status change: the deliverable
// itself IS the product (emails live in ```email blocks and are sent by a
// human). Executors must never throw — a failed side effect shouldn't undo
// the ship; it's reported in the ship note instead.
// ---------------------------------------------------------------------------
import type { WorkOrder } from "./types";
import {
  findInvoiceByNumber,
  recordCustomerPayment,
  resolveSummitLocation,
} from "../zoho-books";

interface PaymentItem {
  invoiceNumber: string;
  customer: string;
  amount: number;
  date: string;
  paymentMode?: string;
  reference?: string;
}

/** Parse the LAST ```payment fenced block from the deliverable. */
export function parsePaymentPackage(text: string): PaymentItem[] {
  const matches = [...text.matchAll(/```payment\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return [];
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1].trim());
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((p) => {
        const item = p as Record<string, unknown>;
        return {
          invoiceNumber: String(item.invoice_number ?? "").trim(),
          customer: String(item.customer ?? "").trim(),
          amount: Number(item.amount ?? 0),
          date: String(item.date ?? "").trim(),
          paymentMode: item.payment_mode ? String(item.payment_mode) : undefined,
          reference: item.reference ? String(item.reference) : undefined,
        };
      })
      .filter(
        (p) =>
          p.invoiceNumber.length > 0 &&
          Number.isFinite(p.amount) &&
          p.amount > 0 &&
          /^\d{4}-\d{2}-\d{2}$/.test(p.date)
      );
  } catch {
    return [];
  }
}

/** Finance: approved remittance matches become recorded payments in Books. */
async function shipFinanceOrder(order: WorkOrder): Promise<string | null> {
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "";
  const items = parsePaymentPackage(draft);
  if (items.length === 0) return null; // reports/categorizations ship as-is

  const location = await resolveSummitLocation().catch(() => null);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const item of items) {
    try {
      const invoice = await findInvoiceByNumber(item.invoiceNumber);
      if (!invoice) {
        skipped.push(`${item.invoiceNumber}: not found in Books`);
        continue;
      }
      if (invoice.status === "paid" || invoice.balance <= 0) {
        skipped.push(`${item.invoiceNumber}: already paid`);
        continue;
      }
      if (item.amount > invoice.balance + 0.01) {
        skipped.push(
          `${item.invoiceNumber}: proposed $${item.amount.toFixed(2)} exceeds balance $${invoice.balance.toFixed(2)}`
        );
        continue;
      }
      await recordCustomerPayment({
        customer_id: invoice.customer_id,
        invoice_id: invoice.invoice_id,
        amount: item.amount,
        date: item.date,
        payment_mode: item.paymentMode,
        reference_number: item.reference,
        branch_id: location?.id,
      });
      applied.push(`${item.invoiceNumber} — $${item.amount.toFixed(2)} (${invoice.customer_name})`);
    } catch (err) {
      skipped.push(
        `${item.invoiceNumber}: ${err instanceof Error ? err.message.slice(0, 120) : "failed"}`
      );
    }
  }

  const parts: string[] = [];
  if (applied.length > 0)
    parts.push(`${applied.length} payment${applied.length === 1 ? "" : "s"} recorded in Zoho Books: ${applied.join("; ")}`);
  if (skipped.length > 0)
    parts.push(`${skipped.length} skipped — ${skipped.join("; ")}`);
  return parts.length > 0 ? `${parts.join(". ")}.` : null;
}

/**
 * Run the department's ship executor. Returns a human-readable note about
 * what shipping did, or null when shipping is just the status change.
 */
export async function executeShip(order: WorkOrder): Promise<string | null> {
  try {
    if (order.departmentId === "finance") {
      return await shipFinanceOrder(order);
    }
    return null;
  } catch (err) {
    console.error(`[ship-executor] ${order.id} side effect failed:`, err);
    return `Ship recorded, but the follow-on automation failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}
