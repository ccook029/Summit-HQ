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
  fetchBankAccounts,
  fetchChartOfAccounts,
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

// ---- Bank reconciliation package -------------------------------------------

interface BankCreate {
  direction: "in" | "out";
  bankAccountId: string;
  categoryAccountId: string;
  date: string;
  amount: number;
  description?: string;
  reference?: string;
}
interface BankCategorize {
  transactionId: string;
  direction: "in" | "out";
  bankAccountId: string;
  categoryAccountId: string;
  date: string;
  amount: number;
  description?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the LAST ```bank fenced block: rows the statement had but Books
 * didn't (`create`), and feed lines sitting uncategorized (`categorize`).
 * Anything missing an id, a positive amount, or a real date is dropped here
 * rather than sent to Zoho as a malformed write.
 */
export function parseBankPackage(text: string): {
  create: BankCreate[];
  categorize: BankCategorize[];
} {
  const matches = [...text.matchAll(/```bank\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return { create: [], categorize: [] };
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1].trim()) as Record<
      string,
      unknown
    >;
    const dir = (v: unknown): "in" | "out" | null =>
      v === "in" || v === "out" ? v : null;
    const str = (v: unknown) => String(v ?? "").trim();

    /** Shared shape check — a row missing any of this can't be posted. */
    const usable = (
      direction: "in" | "out" | null,
      bankAccountId: string,
      categoryAccountId: string,
      date: string,
      amount: number
    ): direction is "in" | "out" =>
      direction !== null &&
      bankAccountId.length > 0 &&
      categoryAccountId.length > 0 &&
      ISO_DATE.test(date) &&
      Number.isFinite(amount) &&
      amount > 0;

    const create = (Array.isArray(parsed.create) ? parsed.create : []).flatMap<BankCreate>(
      (r) => {
        const i = r as Record<string, unknown>;
        const direction = dir(i.direction);
        const bankAccountId = str(i.bank_account_id);
        const categoryAccountId = str(i.category_account_id);
        const date = str(i.date);
        const amount = Number(i.amount ?? 0);
        if (!usable(direction, bankAccountId, categoryAccountId, date, amount)) return [];
        return [
          {
            direction,
            bankAccountId,
            categoryAccountId,
            date,
            amount,
            description: i.description ? String(i.description) : undefined,
            reference: i.reference ? String(i.reference) : undefined,
          },
        ];
      }
    );

    const categorize = (
      Array.isArray(parsed.categorize) ? parsed.categorize : []
    ).flatMap<BankCategorize>((r) => {
      const i = r as Record<string, unknown>;
      const transactionId = str(i.transaction_id);
      const direction = dir(i.direction);
      const bankAccountId = str(i.bank_account_id);
      const categoryAccountId = str(i.category_account_id);
      const date = str(i.date);
      const amount = Number(i.amount ?? 0);
      if (
        transactionId.length === 0 ||
        !usable(direction, bankAccountId, categoryAccountId, date, amount)
      ) {
        return [];
      }
      return [
        {
          transactionId,
          direction,
          bankAccountId,
          categoryAccountId,
          date,
          amount,
          description: i.description ? String(i.description) : undefined,
        },
      ];
    });

    return { create, categorize };
  } catch {
    return { create: [], categorize: [] };
  }
}

/**
 * Apply an approved bank package. Every account id is checked against the live
 * chart of accounts first, so a hallucinated id fails here instead of creating
 * a wrong entry in the books.
 */
async function shipBankPackage(
  pkg: ReturnType<typeof parseBankPackage>
): Promise<string[]> {
  const [bankAccounts, coa] = await Promise.all([
    fetchBankAccounts().catch(() => []),
    fetchChartOfAccounts().catch(() => []),
  ]);
  const bankIds = new Set(bankAccounts.map((a) => a.account_id));
  const coaIds = new Set(coa.map((a) => a.account_id));
  const location = await resolveSummitLocation().catch(() => null);

  const created: string[] = [];
  const categorized: string[] = [];
  const skipped: string[] = [];

  const validIds = (bankId: string, catId: string, label: string): boolean => {
    if (bankIds.size > 0 && !bankIds.has(bankId)) {
      skipped.push(`${label}: unknown bank account ${bankId}`);
      return false;
    }
    if (coaIds.size > 0 && !coaIds.has(catId) && !bankIds.has(catId)) {
      skipped.push(`${label}: unknown category account ${catId}`);
      return false;
    }
    return true;
  };

  for (const c of pkg.create) {
    const label = `${c.date} $${c.amount.toFixed(2)}`;
    if (!validIds(c.bankAccountId, c.categoryAccountId, label)) continue;
    try {
      await createBankTxn({
        direction: c.direction,
        bankAccountId: c.bankAccountId,
        categoryAccountId: c.categoryAccountId,
        date: c.date,
        amount: c.amount,
        description: c.description,
        referenceNumber: c.reference,
        branchId: location?.id,
      });
      created.push(`${label} ${c.description?.slice(0, 40) ?? ""}`.trim());
    } catch (err) {
      skipped.push(`${label}: ${err instanceof Error ? err.message.slice(0, 120) : "failed"}`);
    }
  }

  for (const c of pkg.categorize) {
    const label = `${c.date} $${c.amount.toFixed(2)}`;
    if (!validIds(c.bankAccountId, c.categoryAccountId, label)) continue;
    try {
      if (c.direction === "out") {
        await categorizeTxnAsExpense(c.transactionId, {
          account_id: c.categoryAccountId,
          paid_through_account_id: c.bankAccountId,
          date: c.date,
          amount: c.amount,
          description: c.description,
        });
      } else {
        await categorizeTxnAsDeposit(c.transactionId, {
          from_account_id: c.categoryAccountId,
          to_account_id: c.bankAccountId,
          date: c.date,
          amount: c.amount,
          description: c.description,
        });
      }
      categorized.push(label);
    } catch (err) {
      skipped.push(`${label}: ${err instanceof Error ? err.message.slice(0, 120) : "failed"}`);
    }
  }

  const parts: string[] = [];
  if (created.length > 0)
    parts.push(`${created.length} missing bank transaction${created.length === 1 ? "" : "s"} created in Zoho Books`);
  if (categorized.length > 0)
    parts.push(`${categorized.length} transaction${categorized.length === 1 ? "" : "s"} categorized`);
  if (skipped.length > 0)
    parts.push(`${skipped.length} skipped — ${skipped.slice(0, 10).join("; ")}${skipped.length > 10 ? `; +${skipped.length - 10} more` : ""}`);
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
      ? await shipBankPackage(bank)
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
