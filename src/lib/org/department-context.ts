// ---------------------------------------------------------------------------
// org/department-context.ts — per-department grounding for the engine
//
// The engine appends whatever a department returns here to BOTH the worker's
// and the boss's system prompts, so an employee drafts and their reviewer
// judges against the identical live data. Every provider is best-effort:
// a missing integration degrades to a note, never an error.
//
//   finance    → Zoho Books snapshot (cash, A/R, A/P) — live once the Zoho
//                env vars are set; degrades to a "paste a report" note.
//   operations → static note (no live ops feed wired yet) + recent signals
//   bizdev     → prospecting scope note + recent signals (timely hooks)
//   executive  → the owner's queue + company-wide signals
// ---------------------------------------------------------------------------
import type { Employee } from "./types";
import { fetchBooksSnapshot } from "../zoho-books";
import { getRecentSignals } from "../signals";
import { getOwnerQueue } from "./work-orders";

function safeBlock(
  label: string,
  p: Promise<string>,
  maxChars = 5000
): Promise<string> {
  return p
    .then((s) => `=== ${label} ===\n${s.slice(0, maxChars)}\n=== END ===`)
    .catch(
      (e: unknown) =>
        `=== ${label} ===\n(unavailable this run: ${e instanceof Error ? e.message : String(e)})\n=== END ===`
    );
}

async function renderSignalsBlock(label: string, limit: number): Promise<string> {
  const signals = await getRecentSignals(24 * 7).catch(() => []);
  const body =
    signals.length === 0
      ? "(quiet week)"
      : signals
          .slice(0, limit)
          .map((s) => `- [${s.source}] ${s.headline}`)
          .join("\n");
  return [`=== ${label} ===`, body, "=== END ==="].join("\n");
}

async function renderFinanceContext(): Promise<string> {
  const books = await safeBlock(
    "ZOHO BOOKS SNAPSHOT (cash, A/R, A/P — the live books)",
    fetchBooksSnapshot()
  );
  return [
    "",
    "",
    books,
    "",
    "(If the snapshot above is unavailable, the Zoho Books integration isn't wired yet — work from any report pasted into the brief, and say plainly which numbers you couldn't verify.)",
  ].join("\n");
}

async function renderOperationsContext(): Promise<string> {
  const signals = await renderSignalsBlock(
    "WHAT THE COMPANY DID THIS WEEK (signals)",
    10
  );
  return [
    "",
    "",
    "=== OPERATIONS DATA ===",
    "(No live operations feed is wired into the hub yet — work from the work-order brief and company knowledge. When a fact you need isn't there — a vendor's contact, what was agreed, a delivery date — raise a decision request instead of assuming.)",
    "=== END ===",
    "",
    signals,
  ].join("\n");
}

async function renderBizdevContext(): Promise<string> {
  const signals = await renderSignalsBlock(
    "WHAT SUMMIT DID THIS WEEK (timely hooks for outreach)",
    12
  );
  return [
    "",
    "",
    "=== PROSPECTING SCOPE ===",
    "Summit Equipment buys, sells, and leases liquid and dry bulk pneumatic tanks (Strathroy, Ontario). Prospects are therefore typically bulk carriers, tanker fleet operators, and businesses that haul liquid or dry bulk product. The precise ideal-customer profile lives in the company knowledge (/knowledge screen) — judge every prospect against it, and if the ICP or target segments haven't been defined there yet, raise a decision request asking the owner to define them rather than assuming.",
    "=== END SCOPE ===",
    "",
    signals,
  ].join("\n");
}

async function renderExecutiveContext(): Promise<string> {
  const [signals, queue] = await Promise.all([
    getRecentSignals(24 * 7).catch(() => []),
    getOwnerQueue().catch(() => []),
  ]);
  const signalBlock =
    signals.length === 0
      ? "(quiet week)"
      : signals
          .slice(0, 30)
          .map((s) => `- [${s.source}] ${s.headline}`)
          .join("\n");

  const approved = queue.filter((o) => o.status === "approved");
  const escalated = queue.filter((o) => o.status === "escalated");
  const queueBlock =
    queue.length === 0
      ? "(nothing waiting on the owner right now)"
      : [
          `${approved.length} boss-approved and waiting to ship:`,
          ...approved.slice(0, 20).map((o) => `  - [${o.departmentId}] ${o.title}`),
          `${escalated.length} escalated — needs an owner decision:`,
          ...escalated.slice(0, 20).map((o) => `  - [${o.departmentId}] ${o.title}`),
        ].join("\n");

  return [
    "",
    "",
    "=== THE OWNER'S QUEUE (what's waiting on Chris right now) ===",
    queueBlock,
    "=== END QUEUE ===",
    "",
    "=== COMPANY ACTIVITY — LAST 7 DAYS (every department's signals) ===",
    signalBlock,
    "=== END ACTIVITY ===",
  ].join("\n");
}

export async function renderDepartmentContext(
  employee: Employee
): Promise<string> {
  try {
    switch (employee.departmentId) {
      case "finance":
        return await renderFinanceContext();
      case "operations":
        return await renderOperationsContext();
      case "bizdev":
        return await renderBizdevContext();
      case "executive":
        return await renderExecutiveContext();
      default:
        return "";
    }
  } catch {
    return "";
  }
}
