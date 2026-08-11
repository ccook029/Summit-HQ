"use client";

// ---------------------------------------------------------------------------
// /work — The work board. Where every piece of work currently sits.
//
// The gap this fills: work moves worker → boss → owner, but each surface only
// showed one slice of that (an employee page showed their orders, /review
// showed what needs the owner). Nothing showed the HANDOFFS. This does:
// every order, grouped by who is holding it, with a full trail of every
// draft and every review so a handoff is never invisible.
//
// It is also the recovery surface: anything live that hasn't moved in
// STALL_MINUTES gets a Run button, because a serverless run killed by the
// 300s ceiling leaves nobody driving the order.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { stageOf, STALL_MINUTES, type StageLane } from "@/lib/org/stage";

interface WorkRound {
  round: number;
  draft: string;
  at: string;
  feedback?: string;
}
interface ManagerReview {
  round: number;
  verdict: string;
  notes: string;
  feedback?: string;
  at: string;
}
interface WorkOrder {
  id: string;
  departmentId: string;
  assigneeId: string;
  title: string;
  brief: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  rounds: WorkRound[];
  reviews: ManagerReview[];
  shippedAt?: string;
  shipNote?: string;
  ownerNotes?: string;
  error?: string;
}
interface Employee {
  id: string;
  name: string;
  departmentId: string;
  reportsTo: string | null;
}
interface Department {
  id: string;
  name: string;
  managerId: string | null;
}

const LANES: { key: StageLane; title: string; blurb: string; tone: string }[] = [
  {
    key: "owner",
    title: "With you",
    blurb: "Nothing here executes until you approve it in Review.",
    tone: "text-emerald-600",
  },
  {
    key: "boss",
    title: "With the boss",
    blurb: "A manager is deciding whether this is good enough to reach you.",
    tone: "text-indigo-600",
  },
  {
    key: "team",
    title: "With the team",
    blurb: "Being drafted or redone. No action from you.",
    tone: "text-sky-700",
  },
  {
    key: "problem",
    title: "Stuck",
    blurb: "Failed partway through. Retry runs it again from the top.",
    tone: "text-red-600",
  },
  {
    key: "done",
    title: "Finished",
    blurb: "Approved and executed, or killed.",
    tone: "text-slate-500",
  },
];

function minutesSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 60000);
}

function ago(mins: number | null): string {
  if (mins === null) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

export default function WorkBoardPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [departments, setDepartments] = useState<Record<string, Department>>({});
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const [wo, dir] = await Promise.all([
      fetch("/api/org/work-orders?limit=80").then((r) => r.json()).catch(() => ({})),
      fetch("/api/org/directory").then((r) => r.json()).catch(() => ({})),
    ]);
    setOrders(wo.orders ?? []);
    const emp: Record<string, Employee> = {};
    for (const e of dir.employees ?? []) emp[e.id] = e;
    setEmployees(emp);
    const dep: Record<string, Department> = {};
    for (const d of dir.departments ?? []) dep[d.id] = d;
    setDepartments(dep);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live work is worth re-checking on its own — a handoff happens without any
  // click from the owner, so a static page would show a stale holder.
  useEffect(() => {
    const anyLive = orders.some((o) => stageOf(o.status).live);
    if (!anyLive) return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [orders, load]);

  const byLane = useMemo(() => {
    const map: Record<StageLane, WorkOrder[]> = {
      owner: [],
      boss: [],
      team: [],
      problem: [],
      done: [],
    };
    for (const o of orders) map[stageOf(o.status).lane].push(o);
    return map;
  }, [orders]);

  const nameOf = (id: string) => employees[id]?.name ?? id;
  const managerNameOf = (o: WorkOrder) => {
    const mgrId = employees[o.assigneeId]?.reportsTo ?? departments[o.departmentId]?.managerId;
    return mgrId ? nameOf(mgrId) : "you";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Work board
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Every piece of work and who is holding it right now. Work moves{" "}
            <span className="text-slate-700">employee → their boss → you</span>, and
            only your approval executes anything.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/review"
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            Review queue
          </Link>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-line bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel p-6 text-sm text-slate-500">
          No work orders yet. Assign work from any employee&apos;s page and it
          shows up here the moment it starts moving.
        </p>
      ) : (
        LANES.map((lane) => {
          const items = byLane[lane.key];
          if (items.length === 0) return null;
          const collapsed = lane.key === "done" && !showDone;
          return (
            <section key={lane.key} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className={`text-xs font-semibold uppercase tracking-wider ${lane.tone}`}>
                  {lane.title} — {items.length}
                </h2>
                {lane.key === "done" && (
                  <button
                    onClick={() => setShowDone((v) => !v)}
                    className="text-[11px] text-slate-500 hover:text-slate-700"
                  >
                    {showDone ? "hide" : "show"}
                  </button>
                )}
              </div>
              {!collapsed && (
                <>
                  <p className="-mt-1 text-xs text-slate-400">{lane.blurb}</p>
                  {items.map((o) => (
                    <BoardCard
                      key={o.id}
                      order={o}
                      assigneeName={nameOf(o.assigneeId)}
                      managerName={managerNameOf(o)}
                      departmentName={departments[o.departmentId]?.name ?? o.departmentId}
                      onDone={load}
                    />
                  ))}
                </>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function BoardCard({
  order,
  assigneeName,
  managerName,
  departmentName,
  onDone,
}: {
  order: WorkOrder;
  assigneeName: string;
  managerName: string;
  departmentName: string;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const stage = stageOf(order.status);
  const mins = minutesSince(order.updatedAt ?? order.createdAt);
  const stalled = stage.live && mins !== null && mins >= STALL_MINUTES;

  const holder =
    stage.holder === "assignee"
      ? assigneeName
      : stage.holder === "manager"
        ? managerName
        : stage.holder === "owner"
          ? "You"
          : null;

  // "Run" covers both cases the engine accepts directly (queued/revision) and
  // the stalled live states, which resume resets to queued first.
  const canRun =
    order.status === "queued" ||
    order.status === "revision" ||
    order.status === "error" ||
    stalled;
  const action =
    order.status === "in_progress" || order.status === "in_review" ? "resume" : "run";

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/org/work-orders/${order.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setNote(d.error ?? `Failed (${res.status})`);
      await onDone();
    } catch {
      setNote("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{order.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {departmentName} · {assigneeName}
            {holder && holder !== assigneeName ? ` → ${holder}` : ""} ·{" "}
            {ago(mins)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${stage.tone}`}
        >
          {stage.label}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        {holder && stage.holder !== "nobody" ? (
          <span className="text-slate-700">
            {holder === "You" ? "You have it. " : `${holder} has it. `}
          </span>
        ) : null}
        {stage.next}
      </p>

      {stalled && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No movement in {mins} minutes — the run was probably cut off partway.
          Run it again to pick it back up.
        </p>
      )}
      {order.error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {order.error}
        </p>
      )}
      {order.shipNote && (
        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {order.shipNote}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-sky/60 hover:text-skydeep"
        >
          {open ? "Hide the trail" : `Trail — ${order.rounds.length + order.reviews.length} steps`}
        </button>
        {stage.lane === "owner" && (
          <Link
            href="/review"
            className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-100"
          >
            Open in Review →
          </Link>
        )}
        {canRun && (
          <button
            onClick={() => void run()}
            disabled={busy}
            className="rounded-full bg-navy px-3 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-navy-deep disabled:opacity-40"
          >
            {busy ? "Running (takes a minute)…" : stalled ? "Run it again" : "Run now"}
          </button>
        )}
        {note && <span className="text-[11px] text-amber-600">{note}</span>}
      </div>

      {open && <Trail order={order} assigneeName={assigneeName} managerName={managerName} />}
    </div>
  );
}

/**
 * The handoff trail: every draft and every review in the order they happened,
 * so "Margot sent it back — then what?" has a visible answer.
 */
function Trail({
  order,
  assigneeName,
  managerName,
}: {
  order: WorkOrder;
  assigneeName: string;
  managerName: string;
}) {
  const steps = useMemo(() => {
    const out: { at: string; who: string; what: string; body: string; tone: string }[] = [
      {
        at: order.createdAt,
        who: order.createdBy,
        what: "assigned the work",
        body: order.brief,
        tone: "border-slate-300",
      },
    ];
    for (const r of order.rounds) {
      out.push({
        at: r.at,
        who: assigneeName,
        what: `submitted draft ${r.round}`,
        body: r.draft,
        tone: "border-sky-300",
      });
    }
    for (const r of order.reviews) {
      const label =
        r.verdict === "approve"
          ? "approved it and sent it to you"
          : r.verdict === "revise"
            ? `sent it back to ${assigneeName.split(" ")[0]} for changes`
            : "escalated it to you";
      out.push({
        at: r.at,
        who: managerName,
        what: label,
        body: [r.notes, r.feedback && `\n\nRequired changes:\n${r.feedback}`]
          .filter(Boolean)
          .join(""),
        tone:
          r.verdict === "approve"
            ? "border-emerald-300"
            : r.verdict === "revise"
              ? "border-amber-300"
              : "border-red-300",
      });
    }
    if (order.ownerNotes) {
      out.push({
        at: order.updatedAt ?? order.createdAt,
        who: "You",
        what: "sent it back with notes",
        body: order.ownerNotes,
        tone: "border-amber-300",
      });
    }
    if (order.shippedAt) {
      out.push({
        at: order.shippedAt,
        who: "You",
        what: "approved it — executed",
        body: order.shipNote ?? "",
        tone: "border-emerald-400",
      });
    }
    return out.sort((a, b) => (a.at < b.at ? -1 : 1));
  }, [order, assigneeName, managerName]);

  return (
    <ol className="mt-3 space-y-3 border-t border-line pt-3">
      {steps.map((s, i) => (
        <li key={i} className={`border-l-2 pl-3 ${s.tone}`}>
          <p className="text-[11px] text-slate-500">
            <span className="font-medium text-slate-700">{s.who}</span> {s.what} ·{" "}
            {s.at.slice(0, 16).replace("T", " ")}
          </p>
          {s.body.trim() && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">
                read it
              </summary>
              <p className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-xs leading-relaxed text-slate-700">
                {s.body.trim()}
              </p>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
