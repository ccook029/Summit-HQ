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
  categorizeTxnAsDeposit,
  categorizeTxnAsExpense,
  createBankTxn,
  findInvoiceByNumber,
  recordCustomerPayment,
  resolveSummitLocation,
} from "../zoho-books";
import { reconcileStatement } from "../bank-recon";

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

// ---- Bank reconciliation package -------------------------------------------
//
// The bookkeeper never restates a date or an amount. He refers to a statement
// row by its `row` number and a Books line by its `transaction_id`, and
// supplies the one thing that is his to decide: the account. Everything else
// comes from re-running the deterministic match at approval time — so what is
// written matches Books as it stands NOW, not as it stood when he drafted.

interface BankCreateChoice {
  row: number;
  categoryAccountId: string;
  note?: string;
}
interface BankCategorizeChoice {
  transactionId: string;
  categoryAccountId: string;
  note?: string;
}

/** Parse the LAST ```bank fenced block. */
export function parseBankPackage(text: string): {
  create: BankCreateChoice[];
  categorize: BankCategorizeChoice[];
} {
  const matches = [...text.matchAll(/```bank\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return { create: [], categorize: [] };
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1].trim()) as Record<
      string,
      unknown
    >;
    const str = (v: unknown) => String(v ?? "").trim();

    const create = (Array.isArray(parsed.create) ? parsed.create : []).flatMap<BankCreateChoice>(
      (r) => {
        const i = r as Record<string, unknown>;
        const row = Number(i.row);
        const categoryAccountId = str(i.category_account_id);
        if (!Number.isInteger(row) || row < 0 || !categoryAccountId) return [];
        return [{ row, categoryAccountId, note: i.note ? String(i.note) : undefined }];
      }
    );

    const categorize = (
      Array.isArray(parsed.categorize) ? parsed.categorize : []
    ).flatMap<BankCategorizeChoice>((r) => {
      const i = r as Record<string, unknown>;
      const transactionId = str(i.transaction_id);
      const categoryAccountId = str(i.category_account_id);
      if (!transactionId || !categoryAccountId) return [];
      return [
        { transactionId, categoryAccountId, note: i.note ? String(i.note) : undefined },
      ];
    });

    return { create, categorize };
  } catch {
    return { create: [], categorize: [] };
  }
}

/**
 * Apply an approved reconciliation. The statement is re-matched against live
 * Books first, so a row that has since appeared in Books — because the feed
 * caught up, or because you approved an overlapping month — is skipped rather
 * than duplicated.
 */
async function shipBankPackage(
  order: WorkOrder,
  pkg: ReturnType<typeof parseBankPackage>
): Promise<string[]> {
  const csv = (order.attachments ?? []).map((a) => a.text).join("\n");
  if (!csv.trim()) return ["no statement attached to this order — nothing applied"];

  const recon = await reconcileStatement(csv, order.context?.bankAccountId);
  if (recon.error || !recon.bankAccount) {
    return [`nothing applied — ${recon.accountNote}`];
  }

  const bankAccountId = recon.bankAccount.id;
  const stillMissing = new Map(recon.result.missing.map((r) => [r.index, r]));
  const stillUncategorized = new Map(
    recon.result.uncategorized.map((l) => [l.transactionId, l])
  );
  const coaIds = new Set(recon.accounts.map((a) => a.account_id));
  const location = await resolveSummitLocation().catch(() => null);

  const created: string[] = [];
  const categorized: string[] = [];
  const skipped: string[] = [];

  for (const choice of pkg.create) {
    const row = stillMissing.get(choice.row);
    if (!row) {
      skipped.push(`row ${choice.row}: already in Books now, or not in the missing list`);
      continue;
    }
    if (coaIds.size > 0 && !coaIds.has(choice.categoryAccountId)) {
      skipped.push(`row ${choice.row}: unknown account ${choice.categoryAccountId}`);
      continue;
    }
    try {
      await createBankTxn({
        direction: row.direction,
        bankAccountId,
        categoryAccountId: choice.categoryAccountId,
        date: row.date,
        amount: row.amount,
        description: row.description,
        referenceNumber: choice.note,
        branchId: location?.id,
      });
      created.push(`${row.date} $${row.amount.toFixed(2)}`);
    } catch (err) {
      skipped.push(
        `row ${choice.row}: ${err instanceof Error ? err.message.slice(0, 120) : "failed"}`
      );
    }
  }

  for (const choice of pkg.categorize) {
    const line = stillUncategorized.get(choice.transactionId);
    if (!line) {
      skipped.push(`${choice.transactionId}: no longer uncategorized in Books`);
      continue;
    }
    if (coaIds.size > 0 && !coaIds.has(choice.categoryAccountId)) {
      skipped.push(`${choice.transactionId}: unknown account ${choice.categoryAccountId}`);
      continue;
    }
    // An "unknown" direction is exactly the case where guessing costs a
    // reversed entry — leave it for a human.
    if (line.direction === "unknown") {
      skipped.push(`${choice.transactionId}: Books doesn't say whether it's money in or out`);
      continue;
    }
    try {
      if (line.direction === "out") {
        await categorizeTxnAsExpense(line.transactionId, {
          account_id: choice.categoryAccountId,
          paid_through_account_id: bankAccountId,
          date: line.date,
          amount: line.amount,
          description: line.description,
        });
      } else {
        await categorizeTxnAsDeposit(line.transactionId, {
          from_account_id: choice.categoryAccountId,
          to_account_id: bankAccountId,
          date: line.date,
          amount: line.amount,
          description: line.description,
        });
      }
      categorized.push(`${line.date} $${line.amount.toFixed(2)}`);
    } catch (err) {
      skipped.push(
        `${choice.transactionId}: ${err instanceof Error ? err.message.slice(0, 120) : "failed"}`
      );
    }
  }

  const parts: string[] = [];
  if (created.length > 0)
    parts.push(
      `${created.length} missing transaction${created.length === 1 ? "" : "s"} created in "${recon.bankAccount.name}"`
    );
  if (categorized.length > 0)
    parts.push(`${categorized.length} transaction${categorized.length === 1 ? "" : "s"} categorized`);
  if (skipped.length > 0)
    parts.push(
      `${skipped.length} skipped — ${skipped.slice(0, 8).join("; ")}${skipped.length > 8 ? `; +${skipped.length - 8} more` : ""}`
    );
  return parts;
}

/** Finance: approved remittance matches become recorded payments in Books. */
async function shipFinanceOrder(order: WorkOrder): Promise<string | null> {
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "";

  // A reconciliation ships a bank package; a remittance sweep ships payments.
  // An order can carry both, so both are applied.
  const bank = parseBankPackage(draft);
  const bankNotes =
    bank.create.length + bank.categorize.length > 0
      ? await shipBankPackage(order, bank)
      : [];

  const items = parsePaymentPackage(draft);
  if (items.length === 0) {
    return bankNotes.length > 0 ? `${bankNotes.join(". ")}.` : null;
  }

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

  const parts: string[] = [...bankNotes];
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
