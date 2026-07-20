"use client";

// ---------------------------------------------------------------------------
// /questions — the owner's decisions console, org-wide.
//
// Every open escalation across every department, in one queue. Answering one
// resolves the question AND records the answer as standing department policy
// (the "never ask twice" pathway, via /api/org/escalations).
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Escalation {
  id: string;
  question: string;
  reason: string;
  recommendation?: string;
  dollarAmount?: number;
  status: "open" | "resolved";
  raisedAt: string;
  departmentId: string;
  departmentName?: string;
}

export default function QuestionsPage() {
  const [open, setOpen] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/escalations");
      const data = await res.json();
      setOpen(data.escalations ?? []);
    } catch {
      setOpen([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const answer = async (esc: Escalation) => {
    const text = (answers[esc.id] ?? "").trim();
    if (!text) return;
    setAnswering(esc.id);
    try {
      await fetch("/api/org/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: esc.departmentId,
          escalationId: esc.id,
          answer: text,
          answeredBy: "Chris Cook",
        }),
      });
      await load();
    } finally {
      setAnswering(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Open <span className="text-skydeep">Questions</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Every question your employees are waiting on. Each answer is
            recorded as standing policy, so nothing is asked twice.
          </p>
        </div>
        <Link
          href="/review"
          className="rounded-lg border border-line bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
        >
          Review Queue &rarr;
        </Link>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : open.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel p-8 text-center text-slate-500">
          Nothing is waiting on you. Escalations your bosses can&apos;t resolve
          land here.
        </div>
      ) : (
        <div className="space-y-4">
          {open.map((esc) => (
            <div
              key={`${esc.departmentId}:${esc.id}`}
              className="rounded-xl border border-amber-200 bg-amber-50/60 p-5"
            >
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-amber-600/80">
                <span>{esc.departmentName ?? esc.departmentId}</span>
                <span className="text-slate-400">
                  · {new Date(esc.raisedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="font-medium text-slate-900">{esc.question}</p>
              {esc.reason && (
                <p className="mt-1 text-sm text-slate-500">{esc.reason}</p>
              )}
              {esc.recommendation && (
                <p className="mt-2 rounded-lg border border-line bg-paper/60 px-3 py-2 text-sm text-slate-500">
                  <span className="text-slate-500">Recommended:</span>{" "}
                  {esc.recommendation}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <input
                  value={answers[esc.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [esc.id]: e.target.value }))
                  }
                  placeholder="Your decision — becomes standing policy"
                  className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-sky focus:outline-none"
                />
                <button
                  onClick={() => answer(esc)}
                  disabled={answering === esc.id || !(answers[esc.id] ?? "").trim()}
                  className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-deep disabled:opacity-50"
                >
                  {answering === esc.id ? "Saving…" : "Answer"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
