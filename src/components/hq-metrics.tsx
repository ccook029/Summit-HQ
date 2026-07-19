"use client";

// ---------------------------------------------------------------------------
// HqMetrics — the home page's org-status card: what's waiting on the owner,
// what shipped this week, and how busy the company is. Fed by /api/hq-metrics
// (live org-engine state), hidden gracefully while empty or unavailable.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Link from "next/link";
import { CountUp } from "@/components/count-up";

interface HqMetricsData {
  generatedAt: string;
  awaitingApproval: number;
  escalations: number;
  shippedThisWeek: number;
  inProgress: number;
  signalsThisWeek: number;
  staffed: number;
}

export default function HqMetrics() {
  const [data, setData] = useState<HqMetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hq-metrics")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800/60 bg-[#111]/60 p-8 animate-pulse">
        <div className="h-6 w-48 bg-gray-800 rounded mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <div className="h-10 w-20 bg-gray-800 rounded mb-2" />
              <div className="h-4 w-24 bg-gray-800/60 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const needsOwner = data.awaitingApproval + data.escalations;

  return (
    <div className="rounded-xl border border-[#2dd4bf]/20 bg-[#111]/60 relative overflow-hidden">
      {/* Top accent */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#2dd4bf]/60 to-transparent" />

      {/* Waiting on you — hero metric */}
      <Link href="/review" className="block px-8 pt-8 pb-6 border-b border-gray-800/40 hover:bg-white/[0.02] transition-colors">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Waiting on you
        </span>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="font-display text-6xl font-bold text-[#2dd4bf] tabular-nums tracking-tight">
            <CountUp value={needsOwner} />
          </span>
          <span className="text-sm text-gray-500">
            {data.awaitingApproval} approved &amp; ready to ship
            {data.escalations > 0
              ? ` · ${data.escalations} escalation${data.escalations === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Open the Review Queue to approve, send back, or answer.
        </p>
      </Link>

      {/* Org pulse row */}
      <div className="grid grid-cols-3 divide-x divide-gray-800/40">
        <div className="px-8 py-5">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Shipped (7d)
          </span>
          <p className="font-display text-3xl font-bold text-white tabular-nums mt-1">
            <CountUp value={data.shippedThisWeek} />
          </p>
        </div>
        <div className="px-8 py-5">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            In flight
          </span>
          <p className="font-display text-3xl font-bold text-white tabular-nums mt-1">
            <CountUp value={data.inProgress} />
          </p>
        </div>
        <div className="px-8 py-5">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            AI staff
          </span>
          <p className="font-display text-3xl font-bold text-white tabular-nums mt-1">
            <CountUp value={data.staffed} />
          </p>
        </div>
      </div>
    </div>
  );
}
