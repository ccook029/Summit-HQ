// ---------------------------------------------------------------------------
// bank-recon.ts — run a statement against live Zoho Books.
//
// One function, used twice with the same inputs:
//   - the ENGINE calls it to ground the bookkeeper, who then only has to
//     answer "which account?" for the rows the match couldn't place;
//   - the SHIP EXECUTOR calls it again at approval time, so what gets written
//     is checked against Books as it stands at that moment. Anything recorded
//     in between (by the bank feed, or by a month you approved five minutes
//     ago) drops out instead of being duplicated.
// ---------------------------------------------------------------------------
import {
  fetchBankAccounts,
  fetchBankTxnsInRange,
  fetchChartOfAccounts,
  txnDirection,
  type BooksAccount,
} from "./zoho-books";
import {
  matchStatement,
  parseStatementRows,
  type BooksLine,
  type MatchResult,
  type StatementRow,
} from "./bank-match";

export interface Reconciliation {
  result: MatchResult;
  /** The Books bank account this statement was reconciled against. */
  bankAccount: { id: string; name: string } | null;
  /** Why that account was chosen — shown to the owner, never silent. */
  accountNote: string;
  accounts: BooksAccount[];
  window: { from: string; to: string } | null;
  error?: string;
}

/** Widen the statement's own span by a few days so edge rows can still match. */
function windowOf(rows: StatementRow[]): { from: string; to: string } | null {
  if (rows.length === 0) return null;
  const dates = rows.map((r) => r.date).sort();
  const shift = (iso: string, days: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(dates[0], -5), to: shift(dates[dates.length - 1], 5) };
}

/**
 * Reconcile the statement CSV against Books.
 *
 * `preferredAccountId` is the account the owner picked at upload. Without one,
 * the account whose lines match the most statement rows wins — and if nothing
 * matches anywhere (a window Books has never seen), a lone bank account is
 * used and anything more ambiguous is left null for the owner to resolve.
 */
export async function reconcileStatement(
  csv: string,
  preferredAccountId?: string
): Promise<Reconciliation> {
  const { rows, unparsed } = parseStatementRows(csv);
  const empty: MatchResult = {
    rows,
    matched: [],
    missing: rows,
    booksOnly: [],
    uncategorized: [],
    unparsed,
  };
  const window = windowOf(rows);
  if (!window) {
    return {
      result: empty,
      bankAccount: null,
      accountNote: "No dated rows could be read from the file.",
      accounts: [],
      window: null,
      error: "no-rows",
    };
  }

  const [bankAccounts, accounts] = await Promise.all([
    fetchBankAccounts().catch(() => []),
    fetchChartOfAccounts().catch(() => [] as BooksAccount[]),
  ]);
  if (bankAccounts.length === 0) {
    return {
      result: empty,
      bankAccount: null,
      accountNote: "No bank accounts could be read from Zoho Books.",
      accounts,
      window,
      error: "no-bank-accounts",
    };
  }

  const toLine = (acct: { account_id: string; account_name: string }) =>
    (t: Parameters<typeof txnDirection>[0]): BooksLine => ({
      transactionId: String(t.transaction_id),
      date: String(t.date ?? "").slice(0, 10),
      amount: Math.abs(Number(t.amount ?? 0)),
      direction: txnDirection(t),
      description: [t.payee, t.description].filter(Boolean).join(" — ").slice(0, 200),
      status: String(t.status ?? ""),
      accountId: t.account_id ?? acct.account_id,
      accountName: acct.account_name,
    });

  // Only fetch the account(s) that could be this statement's.
  const candidates = preferredAccountId
    ? bankAccounts.filter((a) => a.account_id === preferredAccountId)
    : bankAccounts;
  if (candidates.length === 0) {
    return {
      result: empty,
      bankAccount: null,
      accountNote: `The chosen bank account (${preferredAccountId}) no longer exists in Books.`,
      accounts,
      window,
      error: "unknown-account",
    };
  }

  let best: { account: (typeof bankAccounts)[number]; result: MatchResult } | null = null;
  for (const acct of candidates) {
    const fetched = await fetchBankTxnsInRange({
      accountId: acct.account_id,
      from: window.from,
      to: window.to,
    }).catch(() => null);
    if (!fetched) continue;
    const lines = fetched.items.map(toLine(acct));
    const result = { ...matchStatement(rows, lines), unparsed };
    if (!best || result.matched.length > best.result.matched.length) {
      best = { account: acct, result };
    }
  }

  if (!best) {
    return {
      result: empty,
      bankAccount: null,
      accountNote: "Zoho Books returned no bank transactions for this window.",
      accounts,
      window,
      error: "books-unreachable",
    };
  }

  // Nothing matched anywhere: only safe to name an account if there's one.
  if (best.result.matched.length === 0 && !preferredAccountId && bankAccounts.length > 1) {
    return {
      result: best.result,
      bankAccount: null,
      accountNote: `Not one statement row matched any of the ${bankAccounts.length} bank accounts, so which account this file belongs to can't be determined. Pick it at upload before anything is created.`,
      accounts,
      window,
      error: "ambiguous-account",
    };
  }

  const account = best.account;
  return {
    result: best.result,
    bankAccount: { id: account.account_id, name: account.account_name },
    accountNote: preferredAccountId
      ? `Reconciled against "${account.account_name}" (chosen at upload).`
      : best.result.matched.length > 0
        ? `Reconciled against "${account.account_name}" — it matched the most rows (${best.result.matched.length}).`
        : `Reconciled against "${account.account_name}" — the only bank account in Books.`,
    accounts,
    window,
  };
}

/**
 * The bookkeeper's grounding. Deliberately does NOT include the matched rows:
 * they are settled, and re-reading 400 of them is how the important 40 get
 * lost. What's here is the arithmetic, the rows needing an account, and the
 * accounts to choose from.
 */
export function renderReconciliation(recon: Reconciliation): string {
  const { result, bankAccount, accountNote, accounts, window } = recon;
  const lines: string[] = ["## Bank reconciliation — already done, in code"];

  if (recon.error) {
    lines.push(
      "",
      `**This reconciliation could not run: ${accountNote}**`,
      "Report exactly that. Do NOT propose creating or categorizing anything.",
      ""
    );
    return lines.join("\n");
  }

  lines.push(
    "",
    `Window: ${window?.from} → ${window?.to}`,
    accountNote,
    `Bank account id for everything below: **${bankAccount?.id}**`,
    "",
    "### The arithmetic (already checked — do not recount)",
    `- Rows in the file: **${result.rows.length}**${result.unparsed > 0 ? ` (+${result.unparsed} unreadable, listed as a problem)` : ""}`,
    `- Already in Books: **${result.matched.length}**`,
    `- Missing from Books: **${result.missing.length}**`,
    `- In Books but uncategorized: **${result.uncategorized.length}**`,
    `- In Books over this window but not on the statement: **${result.booksOnly.length}**`,
    "",
    "Every row was matched on amount, direction and date (±3 days), one-to-one, so a repeated fee can't be counted as recorded twice. Your job is NOT to re-do this match. Your job is to give each row below the account it should post to.",
    ""
  );

  if (result.missing.length > 0) {
    lines.push(
      `### MISSING from Books — ${result.missing.length} row(s) to create`,
      "Refer to each by its `row` number. You never retype the date or amount — those are taken from the file.",
      "| row | Date | Direction | Amount | Description |",
      "|---|---|---|---|---|"
    );
    for (const r of result.missing) {
      lines.push(
        `| ${r.index} | ${r.date} | ${r.direction === "out" ? "money out" : "money in"} | $${r.amount.toFixed(2)} | ${r.description} |`
      );
    }
    lines.push("");
  }

  if (result.uncategorized.length > 0) {
    lines.push(
      `### In Books, UNCATEGORIZED — ${result.uncategorized.length} line(s) to categorize`,
      "| transaction_id | Date | Direction | Amount | Description |",
      "|---|---|---|---|---|"
    );
    for (const l of result.uncategorized.slice(0, 300)) {
      lines.push(
        `| ${l.transactionId} | ${l.date} | ${l.direction} | $${l.amount.toFixed(2)} | ${l.description} |`
      );
    }
    if (result.uncategorized.length > 300) {
      lines.push(`| … | ${result.uncategorized.length - 300} more not shown | | | |`);
    }
    lines.push("");
  }

  if (result.booksOnly.length > 0) {
    lines.push(
      `### In Books but NOT on the statement — ${result.booksOnly.length} line(s)`,
      "Usually a window edge or a manual entry. Report them; never propose deleting anything.",
      "| transaction_id | Date | Direction | Amount | Description | Status |",
      "|---|---|---|---|---|---|"
    );
    for (const l of result.booksOnly.slice(0, 60)) {
      lines.push(
        `| ${l.transactionId} | ${l.date} | ${l.direction} | $${l.amount.toFixed(2)} | ${l.description} | ${l.status} |`
      );
    }
    if (result.booksOnly.length > 60) {
      lines.push(`| … | ${result.booksOnly.length - 60} more not shown | | | | |`);
    }
    lines.push("");
  }

  const usable = accounts.filter(
    (a) => a.is_active && !["bank", "credit_card"].includes((a.account_type ?? "").toLowerCase())
  );
  if (usable.length > 0) {
    lines.push(
      `### Accounts you may post to — copy these ids exactly (${usable.length})`,
      "| account_id | Name | Type |",
      "|---|---|---|"
    );
    for (const a of usable.slice(0, 300)) {
      lines.push(`| ${a.account_id} | ${a.account_name} | ${a.account_type} |`);
    }
    lines.push(
      "",
      "Never invent an id. If no account fits a row, leave it out of the block and list it as needing Chris's call."
    );
  }

  return lines.join("\n");
}
