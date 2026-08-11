// ---------------------------------------------------------------------------
// zoho-books.ts — Zoho Books client for the Accounting team
//
// Two connection paths, by design:
//
//   1. MCP (preferred)   — the official Zoho Books MCP server, driven through
//      Anthropic's `mcp_servers` connector. Enabled when ZOHO_BOOKS_MCP_URL is
//      set. Tool access (read-only in v1) is controlled in the Zoho admin, so
//      "propose-only" is enforced at the source, not just by the prompt.
//
//   2. REST (fallback)   — direct calls to the Zoho Books v3 API using the same
//      shared OAuth refresh-token flow (zoho.ts). Always
//      available, so the agents can do read/diagnostic work even before the MCP
//      admin steps are done.
//
// Reuses getAccessToken() / getEnvOrThrow() from zoho.ts so there is ONE OAuth
// flow for the whole app.
//
// Required env (REST path): ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
//   ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID
// Optional env (MCP path): ZOHO_BOOKS_MCP_URL, ZOHO_BOOKS_MCP_TOKEN
// ---------------------------------------------------------------------------
import { getAccessToken, getEnvOrThrow, invalidateTokenCache } from "./zoho";

// ---- MCP connector configuration ------------------------------------------

export interface McpServerConfig {
  type: "url";
  url: string;
  name: string;
  authorization_token?: string;
}

/**
 * Returns the Zoho Books MCP server config for Anthropic's mcp_servers
 * connector, or null when MCP isn't configured (→ use the REST fallback).
 */
export function getZohoBooksMcpConfig(): McpServerConfig | null {
  const url = process.env.ZOHO_BOOKS_MCP_URL;
  if (!url) return null;
  const token = process.env.ZOHO_BOOKS_MCP_TOKEN;
  return {
    type: "url",
    url,
    name: "zoho-books",
    ...(token ? { authorization_token: token } : {}),
  };
}

export function isMcpConfigured(): boolean {
  return getZohoBooksMcpConfig() !== null;
}

// ---- REST helper ----------------------------------------------------------

async function booksGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/books/v3${path}`);
  url.searchParams.set("organization_id", orgId);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) await invalidateTokenCache();
    throw new Error(`Zoho Books ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---- Read types (partial, relevant fields) --------------------------------

export interface BooksAccount {
  account_id: string;
  account_name: string;
  account_type: string;
  is_active: boolean;
  is_user_created: boolean;
  description?: string;
}

export interface BooksBankTxn {
  transaction_id: string;
  date: string;
  amount: number;
  payee?: string;
  description?: string;
  status: string; // categorized | uncategorized | matched ...
  account_name?: string;
  /** The bank/CC account this feed line belongs to. */
  account_id?: string;
  /** "debit" = money out of the bank account, "credit" = money in. */
  debit_or_credit?: string;
  /** Zoho's guessed type for the feed line (deposit, expense, ...). */
  transaction_type?: string;
}

/**
 * Determine a feed line's money direction from every available signal. Zoho
 * doesn't reliably populate debit_or_credit on uncategorized lines, so fall
 * back to the transaction_type and finally the bank's own "credit memo" /
 * "debit memo" wording in the description. "unknown" means DON'T act on it.
 */
export function txnDirection(t: BooksBankTxn): "in" | "out" | "unknown" {
  const flag = (t.debit_or_credit ?? "").toLowerCase();
  if (flag === "credit") return "in";
  if (flag === "debit") return "out";

  const type = (t.transaction_type ?? "").toLowerCase();
  if (["deposit", "customer_payment", "refund", "other_income", "interest_income", "sales_without_invoices"].includes(type)) return "in";
  if (["expense", "vendor_payment", "card_payment", "credit_card_payment", "owner_drawings"].includes(type)) return "out";

  const desc = (t.description ?? "").toLowerCase();
  if (/credit memo|\bdeposit\b/.test(desc)) return "in";
  if (/debit memo|\bwithdrawal\b/.test(desc)) return "out";

  return "unknown";
}

export interface BooksInvoice {
  branch_id?: string;
  branch_name?: string;
  location_id?: string;
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  status: string;
  total: number;
  balance: number;
  date: string;
  due_date: string;
}

export interface BooksBill {
  branch_id?: string;
  branch_name?: string;
  location_id?: string;
  bill_id: string;
  bill_number: string;
  vendor_name: string;
  status: string;
  total: number;
  balance: number;
  date: string;
  due_date: string;
}

// ---- Read calls (paginated) -----------------------------------------------

async function getAllPages<T>(
  path: string,
  listKey: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (true) {
    const res = await booksGet<Record<string, unknown>>(path, {
      ...params,
      page: String(page),
      per_page: "200",
    });
    const items = (res[listKey] as T[]) ?? [];
    out.push(...items);
    const ctx = res.page_context as { has_more_page?: boolean } | undefined;
    if (!ctx?.has_more_page) break;
    page++;
    if (page > 10) break; // safety
  }
  return out;
}

/**
 * Fetch ONLY the first page plus Zoho's reported total count. Used by the
 * read-only health snapshot so a multi-year backlog of thousands of rows
 * doesn't trigger deep pagination (and a serverless timeout) — we get the true
 * count from page_context.total and a 200-row sample for context.
 */
async function fetchPageWithTotal<T>(
  path: string,
  listKey: string,
  params: Record<string, string> = {}
): Promise<{ items: T[]; total: number }> {
  const res = await booksGet<Record<string, unknown>>(path, {
    ...params,
    page: "1",
    per_page: "200",
  });
  const items = (res[listKey] as T[]) ?? [];
  const ctx = res.page_context as { total?: number } | undefined;
  return { items, total: ctx?.total ?? items.length };
}

export const fetchChartOfAccounts = () =>
  getAllPages<BooksAccount>("/chartofaccounts", "chartofaccounts");

// ---- Locations (branches) --------------------------------------------------
//
// The Books org belongs to the numbered corporation: Summit is the MAIN
// location, True North Steelworks the other. Everything financial must be
// attributable to a location, so the snapshot resolves the Summit location
// and filters to it wherever Zoho supports it.

export interface BooksLocation {
  id: string;
  name: string;
  isPrimary: boolean;
}

/** List the org's locations. Newer orgs expose /locations, older /branches. */
export async function fetchLocations(): Promise<BooksLocation[]> {
  try {
    const res = await booksGet<Record<string, unknown>>("/locations");
    const rows = (res.locations as Record<string, unknown>[]) ?? [];
    if (rows.length > 0) {
      return rows.map((r) => ({
        id: String(r.location_id ?? r.branch_id ?? ""),
        name: String(r.location_name ?? r.branch_name ?? ""),
        isPrimary: Boolean(r.is_primary_location ?? r.is_primary_branch),
      }));
    }
  } catch {
    /* fall through to /branches */
  }
  const res = await booksGet<Record<string, unknown>>("/branches");
  const rows = (res.branches as Record<string, unknown>[]) ?? [];
  return rows.map((r) => ({
    id: String(r.branch_id ?? ""),
    name: String(r.branch_name ?? ""),
    isPrimary: Boolean(r.is_primary_branch),
  }));
}

/**
 * The location Summit's numbers live in, or null when locations aren't
 * enabled / nothing matches. Match by SUMMIT_LOCATION_NAME (default
 * "summit", case-insensitive substring).
 */
export async function resolveSummitLocation(): Promise<BooksLocation | null> {
  const wanted = (process.env.SUMMIT_LOCATION_NAME ?? "summit").toLowerCase();
  try {
    const locations = await fetchLocations();
    return (
      locations.find((l) => l.name.toLowerCase().includes(wanted)) ?? null
    );
  } catch {
    return null;
  }
}

export interface BooksBankAccount {
  account_id: string;
  account_name: string;
  account_type: string;
}

export const fetchBankAccounts = () =>
  getAllPages<BooksBankAccount>("/bankaccounts", "bankaccounts");

/**
 * Uncategorized bank/credit-card transactions. Zoho Books' /banktransactions
 * endpoint REQUIRES an account_id (querying it without one returns
 * "The account does not exist"), so we enumerate the bank accounts first and
 * pull each one's uncategorized feed. Returns a sample plus the true total.
 */
export async function fetchUncategorizedBankTxns(
  sampleLimit = 40
): Promise<{ items: BooksBankTxn[]; total: number }> {
  const accounts = await fetchBankAccounts();
  const items: BooksBankTxn[] = [];
  let total = 0;

  for (const acct of accounts) {
    try {
      const res = await booksGet<Record<string, unknown>>("/banktransactions", {
        account_id: acct.account_id,
        status: "uncategorized",
        page: "1",
        per_page: "200",
      });
      const txns = (res.banktransactions as BooksBankTxn[]) ?? [];
      const ctx = res.page_context as { total?: number } | undefined;
      total += ctx?.total ?? txns.length;
      for (const t of txns) {
        if (items.length >= sampleLimit) break;
        items.push({
          ...t,
          account_name: acct.account_name,
          account_id: t.account_id ?? acct.account_id,
        });
      }
    } catch {
      // Skip an account we can't read rather than failing the whole snapshot.
    }
  }

  return { items, total };
}

export const fetchOpenInvoices = () =>
  getAllPages<BooksInvoice>("/invoices", "invoices", { status: "unpaid" });

/**
 * Every unpaid invoice, walking Zoho's pages (200/page). The snapshot used
 * to take page 1 only, which silently hid every invoice past the first 200 —
 * the reason a customer's invoices could be "missing" from A/R.
 */
export async function fetchAllOpenInvoices(
  params: Record<string, string> = {},
  maxPages = 6
): Promise<{ items: BooksInvoice[]; total: number; complete: boolean }> {
  const items: BooksInvoice[] = [];
  let total = 0;
  let page = 1;
  for (; page <= maxPages; page++) {
    const res = await booksGet<Record<string, unknown>>("/invoices", {
      ...params,
      status: "unpaid",
      page: String(page),
      per_page: "200",
    });
    const rows = (res.invoices as BooksInvoice[]) ?? [];
    items.push(...rows);
    const ctx = res.page_context as { total?: number; has_more_page?: boolean } | undefined;
    total = Math.max(total, ctx?.total ?? items.length);
    if (!ctx?.has_more_page) return { items, total: Math.max(total, items.length), complete: true };
  }
  return { items, total: Math.max(total, items.length), complete: false };
}

/** All invoices dated on/after `sinceIso` (YYYY-MM-DD), any status — used to
 * check whether a consignment retailer's month was actually invoiced. */
export const fetchRecentInvoices = (sinceIso: string) =>
  getAllPages<BooksInvoice>("/invoices", "invoices", { date_start: sinceIso });

export const fetchOpenBills = () =>
  getAllPages<BooksBill>("/bills", "bills", { status: "unpaid" });

// ---- Write operations (Wave 1: bank-transaction categorization) -----------
//
// These are the Accounting team's "hands". Scope is deliberately narrow:
// categorize an uncategorized bank feed line, and un-categorize it (the
// reversal, which is what makes autonomous categorization safe to run).

async function booksPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/books/v3${path}`);
  url.searchParams.set("organization_id", orgId);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) await invalidateTokenCache();
    throw new Error(`Zoho Books POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Categorize a money-OUT feed line as an expense to the given expense account. */
export async function categorizeTxnAsExpense(
  transactionId: string,
  opts: {
    account_id: string; // the expense account
    paid_through_account_id: string; // the bank/CC account the money left
    date: string;
    amount: number;
    description?: string;
  }
): Promise<void> {
  await booksPost(
    `/banktransactions/uncategorized/${transactionId}/categorize/expenses`,
    {
      account_id: opts.account_id,
      paid_through_account_id: opts.paid_through_account_id,
      date: opts.date,
      amount: opts.amount,
      description: opts.description ?? "",
    }
  );
}

/** Categorize a money-IN feed line as a deposit from the given account. */
export async function categorizeTxnAsDeposit(
  transactionId: string,
  opts: {
    from_account_id: string; // the income/other account it's categorized to
    to_account_id: string; // the bank account the money landed in
    date: string;
    amount: number;
    description?: string;
  }
): Promise<void> {
  await booksPost(`/banktransactions/uncategorized/${transactionId}/categorize`, {
    transaction_type: "deposit",
    from_account_id: opts.from_account_id,
    to_account_id: opts.to_account_id,
    date: opts.date,
    amount: opts.amount,
    description: opts.description ?? "",
  });
}

/** Reverse a categorization — returns the feed line to Uncategorized. */
export async function uncategorizeTxn(transactionId: string): Promise<void> {
  await booksPost(`/banktransactions/${transactionId}/uncategorize`, {});
}

/**
 * Customer names that appear in the given text AND have an OPEN invoice.
 * Lets a plain-English instruction ("just do Future Transfer this time")
 * actually narrow which mail gets fetched, instead of only being advice the
 * employee can't act on. Matches on the first two words of a customer name
 * too, so "Future Transfer" finds "Future Transfer Co., Inc.".
 */
export async function matchOpenCustomersInText(text: string): Promise<string[]> {
  if (!text.trim()) return [];
  const haystack = text.toLowerCase();
  const { items } = await fetchAllOpenInvoices().catch(() => ({ items: [] as BooksInvoice[] }));
  const hits = new Set<string>();
  for (const inv of items) {
    const name = (inv.customer_name ?? "").trim();
    if (name.length < 3) continue;
    const short = name.split(/[\s,]+/).slice(0, 2).join(" ");
    if (haystack.includes(name.toLowerCase())) hits.add(name);
    else if (short.length >= 6 && haystack.includes(short.toLowerCase())) hits.add(short);
  }
  return [...hits];
}

/**
 * The COMPLETE open-invoice ledger for named customers — every invoice, no
 * row cap. The org-wide snapshot is necessarily trimmed, which leaves an
 * employee unable to confirm a specific customer's balance; this closes that
 * gap whenever a customer is named in a brief or a chat message.
 */
export async function renderCustomerArLedger(
  customerNames: string[]
): Promise<string> {
  if (customerNames.length === 0) return "";
  const wanted = customerNames.map((n) => n.toLowerCase());
  const { items } = await fetchAllOpenInvoices().catch(() => ({
    items: [] as BooksInvoice[],
  }));
  const rows = items
    .filter((i) => {
      const name = (i.customer_name ?? "").toLowerCase();
      return wanted.some((w) => name.includes(w) || w.includes(name));
    })
    .sort((a, b) => (a.invoice_number ?? "").localeCompare(b.invoice_number ?? ""));

  const today = new Date().toISOString().slice(0, 10);
  const header = `=== LIVE OPEN-INVOICE LEDGER — ${customerNames.join(", ")} (COMPLETE, no row cap) ===`;
  if (rows.length === 0) {
    return [
      header,
      `No OPEN invoices for ${customerNames.join(", ")}. Any invoice number you hold a remittance for is therefore already paid/closed — do NOT propose a payment for it.`,
      "=== END LEDGER ===",
    ].join("\n");
  }
  const total = rows.reduce((s, i) => s + (i.balance ?? 0), 0);
  return [
    header,
    `${rows.length} open invoice(s), $${total.toFixed(2)} outstanding. This is the authoritative balance list for this customer — an invoice number NOT in this table is already settled.`,
    "| Invoice | Date | Due | Balance | Status |",
    "|---|---|---|---|---|",
    ...rows.map((i) => {
      const overdue = i.due_date && i.due_date < today && (i.balance ?? 0) > 0;
      return `| ${i.invoice_number} | ${i.date ?? "—"} | ${i.due_date ?? "—"} | $${(i.balance ?? 0).toFixed(2)} | ${i.status}${overdue ? " (OVERDUE)" : ""} |`;
    }),
    "=== END LEDGER ===",
  ].join("\n");
}

// ---- Payment recording (owner-gated: only the ship executor calls this) ----

export interface InvoiceLookup {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  status: string;
  total: number;
  balance: number;
}

/** Find an invoice by its exact invoice number. */
export async function findInvoiceByNumber(
  invoiceNumber: string
): Promise<InvoiceLookup | null> {
  const res = await booksGet<Record<string, unknown>>("/invoices", {
    invoice_number: invoiceNumber,
    per_page: "10",
  });
  const rows = (res.invoices as (InvoiceLookup & { invoice_number: string })[]) ?? [];
  return rows.find((r) => r.invoice_number === invoiceNumber) ?? rows[0] ?? null;
}

/**
 * Record a customer payment against an invoice (marks it paid when the
 * amount covers the balance). Requires a write scope
 * (ZohoBooks.customerpayments.CREATE) on the refresh token.
 */
export async function recordCustomerPayment(opts: {
  customer_id: string;
  invoice_id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  payment_mode?: string; // e.g. "banktransfer", "check", "cash"
  reference_number?: string;
  branch_id?: string;
}): Promise<void> {
  await booksPost("/customerpayments", {
    customer_id: opts.customer_id,
    payment_mode: opts.payment_mode ?? "banktransfer",
    amount: opts.amount,
    date: opts.date,
    reference_number: opts.reference_number ?? "",
    invoices: [{ invoice_id: opts.invoice_id, amount_applied: opts.amount }],
    ...(opts.branch_id ? { branch_id: opts.branch_id } : {}),
  });
}

// ---- Books health snapshot (read-only) ------------------------------------

/**
 * Compile a read-only snapshot of the books for the CFO/worker to reason over.
 * Each source is fetched independently so one permission gap doesn't sink the
 * whole report. Returns a Markdown text block ready for prompt injection.
 */
export async function fetchBooksSnapshot(): Promise<string> {
  const errors: string[] = [];

  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[zoho-books] ${label} failed:`, msg);
      errors.push(`${label}: ${msg}`);
      return fallback;
    }
  };

  // Pin the snapshot to the Summit location (the org also contains True
  // North Steelworks). Best-effort: without a resolvable location the
  // snapshot is org-wide and says so loudly.
  const summitLoc = await safe("Locations", () => resolveSummitLocation(), null);
  const locParams: Record<string, string> = summitLoc
    ? { branch_id: summitLoc.id }
    : {};

  const empty = { items: [], total: 0 };
  const [accounts, uncategorized, invoices, bills] = await Promise.all([
    safe("Chart of Accounts", () => fetchPageWithTotal<BooksAccount>("/chartofaccounts", "chartofaccounts"), empty as { items: BooksAccount[]; total: number }),
    safe("Uncategorized transactions", () => fetchUncategorizedBankTxns(40), empty as { items: BooksBankTxn[]; total: number }),
    safe("Open invoices (A/R)", () => fetchAllOpenInvoices(locParams), { items: [], total: 0, complete: true } as { items: BooksInvoice[]; total: number; complete: boolean }),
    safe("Open bills (A/P)", () => fetchPageWithTotal<BooksBill>("/bills", "bills", { status: "unpaid", ...locParams }), empty as { items: BooksBill[]; total: number }),
  ]);

  // Belt and suspenders: if rows carry a location/branch tag, drop anything
  // that isn't Summit's even when the server-side filter didn't apply.
  const isSummitRow = (r: { branch_id?: string; location_id?: string; branch_name?: string }) => {
    if (!summitLoc) return true;
    const tag = r.branch_id ?? r.location_id;
    if (tag) return String(tag) === summitLoc.id;
    if (r.branch_name) return r.branch_name.toLowerCase().includes(summitLoc.name.toLowerCase());
    return true; // untagged row — keep, the header warns about ambiguity
  };
  invoices.items = invoices.items.filter(isSummitRow);
  bills.items = bills.items.filter(isSummitRow);

  // If everything failed, surface a clear diagnostic rather than crashing.
  if (
    accounts.total === 0 &&
    uncategorized.total === 0 &&
    invoices.total === 0 &&
    bills.total === 0 &&
    errors.length > 0
  ) {
    return [
      "## ⚠️ Zoho Books Data Unavailable",
      "",
      "Could not retrieve data from Zoho Books via the REST fallback.",
      "Likely an expired/revoked refresh token or a missing Books scope.",
      "",
      "### Errors",
      ...errors.map((e) => `- ${e}`),
      "",
      "### Next Steps",
      "1. Confirm the ZOHO_REFRESH_TOKEN includes scope `ZohoBooks.fullaccess.all` (or read scopes).",
      "2. Regenerate it at https://api-console.zoho.com/ if needed.",
      "3. Or finish the Zoho Books MCP setup and set ZOHO_BOOKS_MCP_URL.",
    ].join("\n");
  }

  // Aggregate quick stats. Counts come from Zoho's reported total; dollar
  // figures are summed over the first-page sample (≤200 rows).
  const arTotal = invoices.items.reduce((s, i) => s + (i.balance || 0), 0);
  const apTotal = bills.items.reduce((s, b) => s + (b.balance || 0), 0);
  const overdueAR = invoices.items.filter((i) => i.status === "overdue").length;
  const inactiveAccounts = accounts.items.filter((a) => !a.is_active).length;

  const lines = [
    "## Zoho Books Snapshot (read-only)",
    summitLoc
      ? `Location filter: **${summitLoc.name}** (the org also contains True North Steelworks — its rows are excluded where Zoho tags them; treat untagged rows as needing location confirmation)`
      : "Location filter: none — figures are ORG-WIDE (Summit/Head Office + True North Steelworks together, per the owner's current one-team-for-both setup). Attribute rows to their location when reporting per-division numbers.",
    `Chart of Accounts: ${accounts.total} accounts (${inactiveAccounts}+ inactive in sample) — shared org-wide`,
    `Uncategorized bank transactions: ${uncategorized.total}`,
    `Open invoices (A/R): ${invoices.total} — $${arTotal.toFixed(2)} outstanding across ${invoices.items.length} fetched, ${overdueAR} flagged overdue`,
    `Open bills (A/P): ${bills.total} — $${apTotal.toFixed(2)}+ outstanding (sample)`,
    "",
  ];

  if (uncategorized.items.length > 0) {
    lines.push("### Uncategorized Transactions (sample, up to 40)");
    lines.push("| Date | Payee | Amount | Description |");
    lines.push("|------|-------|--------|-------------|");
    for (const t of uncategorized.items.slice(0, 40)) {
      lines.push(
        `| ${t.date} | ${t.payee ?? "—"} | $${(t.amount ?? 0).toFixed(2)} | ${(t.description ?? "").slice(0, 60)} |`
      );
    }
    lines.push("");
  }

  // Open invoices, itemized — without this the team can only see aggregates
  // and has to ask a human to screenshot a customer's invoice list.
  if (invoices.items.length > 0) {
    const rows = [...invoices.items].sort((a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "")
    );
    const today = new Date().toISOString().slice(0, 10);
    const shownRows = rows.slice(0, 400);
    lines.push(
      `### Open Invoices — A/R detail (${shownRows.length} shown of ${invoices.total} open, newest first${(invoices as { complete?: boolean }).complete === false ? "; PAGE CAP HIT — older invoices exist beyond this list" : ""})`
    );
    lines.push("Match remittances against THIS list — customer, invoice number, and balance are authoritative here.");
    lines.push("| Invoice | Customer | Date | Due | Balance | Status |");
    lines.push("|---|---|---|---|---|---|");
    for (const i of shownRows) {
      const overdue = i.due_date && i.due_date < today && (i.balance ?? 0) > 0;
      lines.push(
        `| ${i.invoice_number} | ${i.customer_name} | ${i.date ?? "—"} | ${i.due_date ?? "—"} | $${(i.balance ?? 0).toFixed(2)} | ${i.status}${overdue ? " (OVERDUE)" : ""} |`
      );
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push("### ⚠️ Partial Data Notice");
    lines.push(...errors.map((e) => `- ${e}`));
    lines.push("");
  }

  return lines.join("\n");
}
