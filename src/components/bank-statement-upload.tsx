"use client";

// ---------------------------------------------------------------------------
// BankStatementUpload — hand a bank statement to the finance team.
//
// Two problems this solves that a chat attachment can't:
//
//  1. SCOPE. A real statement export is years long — 5,000+ rows, 600 KB of
//     CSV. That fits in neither one prompt nor one 300-second serverless run.
//     So the file is split into ONE WORK ORDER PER MONTH here in the browser,
//     each carrying only its own rows. Every month is independently reviewed
//     by the Controller and independently approved by the owner, which is also
//     the right blast radius for something that writes to the books.
//
//  2. PERSISTENCE. A chat attachment lives on one message. These attach to the
//     work order, so the boss's review and every revision round see the rows.
//
// The orders are created "queued" and then run one at a time by the runner
// below — one HTTP request per month, so no single request can time out. Close
// the tab and the rest are still queued on the work board with Run buttons.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/** Comfortably inside both the KV value limit and a sane prompt size. */
const MAX_CHUNK_CHARS = 120_000;

interface Chunk {
  /** "2026-03" */
  period: string;
  header: string;
  rows: string[];
  csv: string;
}

interface ParsedFile {
  name: string;
  sheet: string;
  chunks: Chunk[];
  totalRows: number;
  /** Rows we couldn't date — reported, never silently dropped. */
  undated: number;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Normalize a date cell to "YYYY-MM-DD".
 *
 * Excel stores dates as serial numbers, so a spreadsheet export reaches us as
 * 44565, not "2022-01-04". Writing that straight into the CSV would hand the
 * bookkeeper a column of meaningless integers — so every date is normalized
 * here, once, before the rows are ever chunked or sent.
 */
function isoOf(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    // Excel serial: days since 1899-12-30, offset 25569 from the Unix epoch.
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(value ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) {
    const [a, b] = [Number(slash[1]), Number(slash[2])];
    // D/M/YYYY only when the first field can't be a month.
    const [month, day] = a > 12 ? [b, a] : [a, b];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

/** The month a row belongs to — "2026-03". */
function periodOf(value: unknown): string | null {
  return isoOf(value)?.slice(0, 7) ?? null;
}

async function parseWorkbook(file: File): Promise<ParsedFile> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  let rows: unknown[][];
  let sheetName = file.name;

  if (["csv", "tsv", "txt"].includes(ext) || file.type.startsWith("text/")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.text(), { type: "string", raw: true });
    sheetName = wb.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
  } else if (["xlsx", "xls", "xlsm"].includes(ext)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    // A consolidated export usually has summary tabs alongside the data. Pick
    // the sheet with the most rows that also has a date-ish header.
    let best: { name: string; rows: unknown[][] } | null = null;
    for (const name of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1,
        raw: true,
      });
      if (!best || r.length > best.rows.length) best = { name, rows: r };
    }
    if (!best) throw new Error("empty workbook");
    sheetName = best.name;
    rows = best.rows;
  } else {
    throw new Error("unsupported");
  }

  // Find the header row and its date column — the first row within the first
  // 15 whose cells include something named like a date.
  let headerIdx = -1;
  let dateCol = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
    const idx = cells.findIndex((c) => c === "date" || c.endsWith(" date") || c === "posted");
    if (idx !== -1) {
      headerIdx = i;
      dateCol = idx;
      break;
    }
  }
  if (headerIdx === -1) {
    // No labelled header: fall back to the first column that parses as dates.
    const probe = rows.slice(0, 30);
    const width = Math.max(...probe.map((r) => r?.length ?? 0), 0);
    for (let c = 0; c < width; c++) {
      const hits = probe.filter((r) => periodOf(r?.[c]) !== null).length;
      if (hits >= Math.min(5, probe.length - 1)) {
        dateCol = c;
        headerIdx = 0;
        break;
      }
    }
  }
  if (dateCol === -1) throw new Error("no-date-column");

  // Export tools often park a note in the cells to the right of the real
  // header ("Opening balance derived & bank-verified: …"). Trim the header to
  // the width the data actually uses so every chunk isn't carrying it.
  const dataWidth = Math.max(
    ...rows.slice(headerIdx + 1, headerIdx + 200).map((r) => r?.length ?? 0),
    1
  );
  const header = (rows[headerIdx] ?? []).slice(0, dataWidth).map(csvEscape).join(",");
  const groups = new Map<string, string[]>();
  let undated = 0;
  let totalRows = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;
    const iso = isoOf(row[dateCol]);
    if (!iso) {
      undated++;
      continue;
    }
    const period = iso.slice(0, 7);
    totalRows++;
    // Write the normalized date back into the row, so what the bookkeeper
    // reads is a real date and not an Excel serial.
    const line = row.map((c, idx) => csvEscape(idx === dateCol ? iso : c)).join(",");
    const bucket = groups.get(period);
    if (bucket) bucket.push(line);
    else groups.set(period, [line]);
  }

  // Build the chunks, splitting any oversized month into numbered parts.
  const chunks: Chunk[] = [];
  for (const period of [...groups.keys()].sort()) {
    const lines = groups.get(period)!;
    let part: string[] = [];
    let size = header.length;
    const flush = (suffix: string) => {
      if (part.length === 0) return;
      chunks.push({
        period: period + suffix,
        header,
        rows: part,
        csv: [header, ...part].join("\n"),
      });
      part = [];
      size = header.length;
    };
    for (const line of lines) {
      if (size + line.length > MAX_CHUNK_CHARS) flush(` pt${chunks.length + 1}`);
      part.push(line);
      size += line.length + 1;
    }
    flush("");
  }

  return { name: file.name, sheet: sheetName, chunks, totalRows, undated };
}

interface BankAccountOption {
  account_id: string;
  account_name: string;
  account_type: string;
}

type Phase = "idle" | "creating" | "running" | "done";

export default function BankStatementUpload({
  employeeId,
  employeeName,
  onDone,
}: {
  employeeId: string;
  employeeName: string;
  onDone?: () => Promise<void> | void;
}) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>({
    done: 0,
    total: 0,
    label: "",
  });
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Which Books account this statement belongs to. Naming it up front beats
  // inferring it later: a file whose rows are ALL missing from Books gives the
  // matcher nothing to infer from, which is exactly the backfill case.
  useEffect(() => {
    fetch("/api/org/bank-accounts")
      .then((r) => r.json())
      .then((d) => {
        const list: BankAccountOption[] = d.accounts ?? [];
        setBankAccounts(list);
        if (list.length === 1) setBankAccountId(list[0].account_id);
      })
      .catch(() => {});
  }, []);

  const selected = useMemo(() => {
    if (!parsed) return [];
    return parsed.chunks.filter(
      (c) => (!from || c.period >= from) && (!to || c.period <= to)
    );
  }, [parsed, from, to]);

  const take = useCallback(async (files: FileList | File[] | null) => {
    const f = Array.from(files ?? [])[0];
    if (!f) return;
    setError(null);
    setLog([]);
    setPhase("idle");
    try {
      const p = await parseWorkbook(f);
      if (p.chunks.length === 0) {
        setError(`No dated transaction rows found in ${f.name}.`);
        return;
      }
      setParsed(p);
      setFrom(p.chunks[0].period.slice(0, 7));
      setTo(p.chunks[p.chunks.length - 1].period.slice(0, 7));
    } catch (err) {
      const kind = err instanceof Error ? err.message : "";
      setError(
        kind === "no-date-column"
          ? `Couldn't find a date column in ${f.name}. Make sure the header row has a "Date" column.`
          : kind === "unsupported"
            ? `${f.name} isn't a spreadsheet or CSV — export it as .xlsx or .csv.`
            : `Couldn't read ${f.name}.`
      );
    }
  }, []);

  const briefFor = (chunk: Chunk, index: number, total: number) =>
    `Reconcile the attached bank transactions for ${chunk.period} against Zoho Books. This is period ${index + 1} of ${total} from ${parsed?.name}.\n\n` +
    `1. For EVERY row in the file, decide whether Zoho Books already has it. Your grounding carries every bank line Books holds over this same window — match on date (allow a few days of posting lag) and amount.\n` +
    `2. Rows on the statement that are NOT in Books go in the \`create\` list of your \`bank\` block, each with the account you would post it to.\n` +
    `3. Lines already in Books but sitting uncategorized go in the \`categorize\` list with their transaction_id.\n` +
    `4. Report totals that add up: rows in the file, already recorded, to create, to categorize, and anything you left out because you weren't sure.\n\n` +
    `Use only account ids that appear in your grounding tables. Nothing is written to Books until Chris approves this order in Review.` +
    (notes.trim() ? `\n\nFrom Chris: ${notes.trim()}` : "");

  const start = async () => {
    if (!parsed || selected.length === 0) return;
    cancelled.current = false;
    setError(null);
    setLog([]);
    setPhase("creating");
    setProgress({ done: 0, total: selected.length, label: "Creating work orders…" });

    // Create every order first (fast, no model calls) so the whole job is
    // durable on the work board before any long run starts.
    const created: { id: string; period: string }[] = [];
    for (let i = 0; i < selected.length; i++) {
      const chunk = selected[i];
      try {
        const res = await fetch("/api/org/work-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigneeId: employeeId,
            title: `Bank reconcile ${chunk.period} — ${chunk.rows.length} rows`,
            deliverableType: "bank-reconcile",
            brief: briefFor(chunk, i, selected.length),
            attachments: [{ name: `${parsed.name} (${chunk.period})`, text: chunk.csv }],
            context: bankAccountId ? { bankAccountId } : undefined,
            run: false,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.order?.id) {
          setLog((l) => [...l, `${chunk.period}: couldn't create — ${d.error ?? res.status}`]);
          continue;
        }
        created.push({ id: d.order.id, period: chunk.period });
      } catch {
        setLog((l) => [...l, `${chunk.period}: network error while creating.`]);
      }
      setProgress({ done: i + 1, total: selected.length, label: "Creating work orders…" });
    }

    await onDone?.();

    if (created.length === 0) {
      setError("No work orders were created.");
      setPhase("idle");
      return;
    }

    // Now run them one at a time — each is its own request, so no single run
    // can hit the serverless ceiling on behalf of the others.
    setPhase("running");
    for (let i = 0; i < created.length; i++) {
      if (cancelled.current) {
        setLog((l) => [
          ...l,
          `Stopped. ${created.length - i} period(s) are still queued on the work board.`,
        ]);
        break;
      }
      const { id, period } = created[i];
      setProgress({
        done: i,
        total: created.length,
        label: `${period} — ${employeeName.split(" ")[0]} is working, then his boss reviews it`,
      });
      try {
        const res = await fetch(`/api/org/work-orders/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "run" }),
        });
        const d = await res.json().catch(() => ({}));
        setLog((l) => [
          ...l,
          res.ok
            ? `${period}: ${d.order?.status ?? "done"}`
            : `${period}: ${d.error ?? `failed (${res.status})`} — retry it on the work board.`,
        ]);
      } catch {
        setLog((l) => [...l, `${period}: connection dropped — retry it on the work board.`]);
      }
      setProgress({ done: i + 1, total: created.length, label: "" });
      await onDone?.();
    }

    setPhase("done");
  };

  const busy = phase === "creating" || phase === "running";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-skydeep">
          Reconcile bank transactions
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Drop in a spreadsheet or CSV. It&apos;s split into one job per month —{" "}
          {employeeName.split(" ")[0]} checks every row against what Zoho Books
          already has, proposes the missing ones, and categorizes what&apos;s
          uncategorized. Nothing reaches Books until you approve each month in{" "}
          <Link href="/review" className="text-skydeep hover:underline">
            Review
          </Link>
          .
        </p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) void take(e.dataTransfer?.files ?? null);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`rounded-lg border border-dashed border-line bg-slate-50 px-4 py-6 text-center transition-colors ${
          busy ? "opacity-60" : "cursor-pointer hover:border-sky/60 hover:bg-sky/5"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
          className="hidden"
          onChange={(e) => void take(e.target.files)}
        />
        {parsed ? (
          <p className="text-xs text-slate-700">
            <span className="font-medium">{parsed.name}</span> · sheet &ldquo;{parsed.sheet}&rdquo; ·{" "}
            {parsed.totalRows.toLocaleString()} rows · {parsed.chunks.length} periods
            {parsed.undated > 0 && (
              <span className="text-amber-600">
                {" "}
                · {parsed.undated} row(s) had no readable date and were left out
              </span>
            )}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Drop the file here, or click to choose — .xlsx or .csv
          </p>
        )}
      </div>

      {parsed && (
        <>
          {bankAccounts.length > 0 && (
            <label className="block text-[11px] text-slate-500">
              Which Zoho Books account is this statement?
              <select
                value={bankAccountId}
                disabled={busy}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="ml-2 rounded-md border border-line bg-paper px-2 py-1 text-[11px] text-slate-700 focus:border-sky focus:outline-none"
              >
                <option value="">Work it out from the matches</option>
                {bankAccounts.map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {a.account_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-slate-500">
              From
              <select
                value={from}
                disabled={busy}
                onChange={(e) => setFrom(e.target.value)}
                className="ml-2 rounded-md border border-line bg-paper px-2 py-1 text-[11px] text-slate-700 focus:border-sky focus:outline-none"
              >
                {parsed.chunks.map((c) => (
                  <option key={c.period} value={c.period}>
                    {c.period}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-500">
              To
              <select
                value={to}
                disabled={busy}
                onChange={(e) => setTo(e.target.value)}
                className="ml-2 rounded-md border border-line bg-paper px-2 py-1 text-[11px] text-slate-700 focus:border-sky focus:outline-none"
              >
                {parsed.chunks.map((c) => (
                  <option key={c.period} value={c.period}>
                    {c.period}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-[11px] text-slate-500">
              {selected.length} month{selected.length === 1 ? "" : "s"} ·{" "}
              {selected.reduce((s, c) => s + c.rows.length, 0).toLocaleString()} rows
              {selected.length > 6 && (
                <span className="text-amber-600">
                  {" "}
                  · roughly {Math.round(selected.length * 2.5)} min to work through
                </span>
              )}
            </span>
          </div>

          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
            placeholder="Anything he should know? (which Books account this is, rows to ignore, how to treat owner draws)"
            className="w-full rounded-md border border-line bg-slate-100 px-2 py-1.5 text-xs text-slate-800 focus:border-sky focus:outline-none"
          />
        </>
      )}

      {busy && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-navy transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            {progress.done}/{progress.total} · {progress.label || "working…"} — leave this
            tab open; anything unfinished stays queued on the work board.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void start()}
          disabled={busy || selected.length === 0}
          className="rounded-md bg-navy px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-navy-deep disabled:opacity-40"
        >
          {phase === "creating"
            ? "Creating…"
            : phase === "running"
              ? "Reconciling…"
              : `Reconcile ${selected.length || ""} month${selected.length === 1 ? "" : "s"}`}
        </button>
        {busy && (
          <button
            onClick={() => {
              cancelled.current = true;
            }}
            className="text-[11px] text-slate-500 hover:text-slate-700"
          >
            stop after this one
          </button>
        )}
        {!busy && parsed && (
          <button
            onClick={() => {
              setParsed(null);
              setLog([]);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="text-[11px] text-slate-500 hover:text-slate-700"
          >
            clear
          </button>
        )}
        <Link href="/work" className="text-[11px] text-skydeep hover:underline">
          Work board →
        </Link>
        {phase === "done" && (
          <Link href="/review" className="text-[11px] font-medium text-emerald-700 hover:underline">
            Approve what came back →
          </Link>
        )}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>

      {log.length > 0 && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-slate-50 p-2">
          {log.map((l, i) => (
            <p key={i} className="text-[11px] text-slate-600">
              {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
