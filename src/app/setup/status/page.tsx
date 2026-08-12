"use client";

// ---------------------------------------------------------------------------
// /setup/status — one-click health check of the deployed integrations,
// using the exact production credentials the employees run on.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Link from "next/link";

interface Check {
  ok: boolean;
  detail: string;
}
interface Health {
  configured: boolean;
  note?: string;
  oauth?: Check;
  books?: Check;
  mail?: Check;
  banking?: Check;
  scopes?: string[] | null;
  hint?: string | null;
}

function Row({ label, c }: { label: string; c?: Check }) {
  if (!c) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${c.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
      <span className="font-semibold">{c.ok ? "✅" : "❌"} {label}:</span> {c.detail}
    </div>
  );
}

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/health/integrations")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
          Integration <span className="text-skydeep">Health</span>
        </h1>
        <button onClick={load} disabled={loading}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-deep disabled:opacity-50">
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Tests the exact credentials this deployment runs on — what these say
        is what your employees experience.
      </p>

      {loading ? (
        <p className="text-slate-500">Running live checks…</p>
      ) : !health ? (
        <p className="text-red-600">Health check failed to run — try again.</p>
      ) : !health.configured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {health.note} Set them via <Link href="/setup/zoho" className="underline">/setup/zoho</Link>.
        </div>
      ) : (
        <div className="space-y-3">
          <Row label="Zoho OAuth (refresh token)" c={health.oauth} />
          <Row label="Zoho Books" c={health.books} />
          <Row label="Zoho Mail" c={health.mail} />
          <Row label="Books banking writes (needed to post a reconciliation)" c={health.banking} />
          {health.scopes && health.scopes.length > 0 && (
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Scopes Zoho reports on your token
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {health.scopes.map((s) => (
                  <span key={s} className="rounded-full border border-line bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {health.hint && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {health.hint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
