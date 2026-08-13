// ---------------------------------------------------------------------------
// bank-match.ts — match a bank statement against Zoho Books, in code.
//
// Deciding whether a statement row is already in Books is a join on date and
// amount. It is not a judgment call, and asking a language model to eyeball
// 5,000 rows of it invites exactly the failure you can't detect: a row quietly
// skipped. So the matching happens here, deterministically, and the bookkeeper
// is left with the part that IS judgment — which account each unmatched row
// belongs to.
//
// Pure: no network, no storage. Everything here can be reasoned about and
// tested on its own.
// ---------------------------------------------------------------------------

export interface StatementRow {
  /** Stable position in the parsed file. This is the row's identity — the
   *  bookkeeper refers to rows by index, so it can never mistype an amount. */
  index: number;
  date: string; // YYYY-MM-DD
  /** Always positive; `direction` carries the sign. */
  amount: number;
  direction: "in" | "out";
  description: string;
}

export interface BooksLine {
  transactionId: string;
  date: string;
  amount: number; // positive
  direction: "in" | "out" | "unknown";
  description: string;
  status: string;
  accountId: string;
  accountName: string;
}

export interface MatchResult {
  rows: StatementRow[];
  /** Statement rows found in Books, with what they matched. */
  matched: { row: StatementRow; line: BooksLine; dayGap: number }[];
  /** On the statement, NOT in Books — these are the ones to create. */
  missing: StatementRow[];
  /** In Books over the window, not on the statement. Usually a window edge or
   *  a manual entry; worth reporting, never auto-deleted. */
  booksOnly: BooksLine[];
  /** In Books and uncategorized — these need an account, matched or not. */
  uncategorized: BooksLine[];
  /** Rows the parser couldn't read a date or amount from. */
  unparsed: number;
}

// ---- CSV ------------------------------------------------------------------

/** Split one CSV line, honouring quotes and doubled quotes inside them. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** "$1,234.56" / "(60.00)" / "-60" → a number. Parentheses mean negative. */
function toNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()$\s,]/g, "");
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) {
    const [a, b] = [Number(slash[1]), Number(slash[2])];
    const [month, day] = a > 12 ? [b, a] : [a, b];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

/**
 * Parse the statement CSV into rows. Handles the two shapes real exports come
 * in: one signed Amount column, or separate Debit/Credit columns.
 */
export function parseStatementRows(csv: string): {
  rows: StatementRow[];
  unparsed: number;
} {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], unparsed: 0 };

  const header = splitCsvLine(lines[0]).map(norm);
  const findCol = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.endsWith(` ${n}`)));

  const dateCol = findCol("date", "posted", "transaction date");
  const amountCol = findCol("amount", "value");
  const debitCol = findCol("debit", "withdrawal", "withdrawals", "money out");
  const creditCol = findCol("credit", "deposit", "deposits", "money in");
  const descCol = findCol("description", "details", "payee", "narrative", "memo");
  const typeCol = findCol("transaction type", "type");

  const rows: StatementRow[] = [];
  let unparsed = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const date = dateCol >= 0 ? toIsoDate(cells[dateCol] ?? "") : null;
    if (!date) {
      unparsed++;
      continue;
    }

    let signed: number | null = amountCol >= 0 ? toNumber(cells[amountCol] ?? "") : null;
    if (signed === null || signed === 0) {
      // Fall back to debit/credit columns.
      const debit = debitCol >= 0 ? toNumber(cells[debitCol] ?? "") : null;
      const credit = creditCol >= 0 ? toNumber(cells[creditCol] ?? "") : null;
      if (debit) signed = -Math.abs(debit);
      else if (credit) signed = Math.abs(credit);
    }
    if (signed === null || signed === 0) {
      unparsed++;
      continue;
    }

    const description = [descCol >= 0 ? cells[descCol] : "", typeCol >= 0 ? cells[typeCol] : ""]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(" — ");

    rows.push({
      index: rows.length,
      date,
      amount: Math.abs(signed),
      direction: signed < 0 ? "out" : "in",
      description: description.slice(0, 200),
    });
  }

  return { rows, unparsed };
}

// ---- Matching --------------------------------------------------------------

const dayGap = (a: string, b: string): number =>
  Math.abs(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
      86_400_000
  );

/** Cents, to keep floating-point noise out of the equality test. */
const cents = (n: number) => Math.round(n * 100);

/**
 * Match statement rows against Books lines on amount + direction, allowing
 * `toleranceDays` of posting lag.
 *
 * One-to-one: each Books line can satisfy only ONE statement row. That matters
 * because a real statement is full of genuine duplicates — three $1.00
 * e-transfer fees on the same day — and a naive "does any line match?" test
 * would call all three recorded when Books holds only one.
 *
 * Exact-date matches are consumed first across the whole file, so a same-day
 * line is never spent on a row that a nearby-date row needed.
 */
export function matchStatement(
  rows: StatementRow[],
  books: BooksLine[],
  toleranceDays = 3
): Omit<MatchResult, "unparsed"> {
  const buckets = new Map<string, BooksLine[]>();
  for (const line of books) {
    const key = `${line.direction}:${cents(line.amount)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(line);
    else buckets.set(key, [line]);
  }

  const used = new Set<string>();
  const matched: { row: StatementRow; line: BooksLine; dayGap: number }[] = [];
  const pending = new Set(rows.map((r) => r.index));

  const claim = (row: StatementRow, maxGap: number): boolean => {
    // A Books line whose direction Zoho never populated ("unknown") can still
    // be the right one — try the exact direction first, then the unknowns.
    for (const dir of [row.direction, "unknown"] as const) {
      const candidates = buckets.get(`${dir}:${cents(row.amount)}`);
      if (!candidates) continue;
      let best: { line: BooksLine; gap: number } | null = null;
      for (const line of candidates) {
        if (used.has(line.transactionId)) continue;
        const gap = dayGap(row.date, line.date);
        if (gap > maxGap) continue;
        if (!best || gap < best.gap) best = { line, gap };
      }
      if (best) {
        used.add(best.line.transactionId);
        matched.push({ row, line: best.line, dayGap: best.gap });
        pending.delete(row.index);
        return true;
      }
    }
    return false;
  };

  // Pass 1: same-day only. Pass 2: widen to the tolerance.
  for (const row of rows) claim(row, 0);
  for (const row of rows) {
    if (pending.has(row.index)) claim(row, toleranceDays);
  }

  const missing = rows.filter((r) => pending.has(r.index));
  const booksOnly = books.filter((l) => !used.has(l.transactionId));
  const uncategorized = books.filter(
    (l) => (l.status ?? "").toLowerCase() === "uncategorized"
  );

  return { rows, matched, missing, booksOnly, uncategorized };
}
