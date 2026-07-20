"use client";

// ---------------------------------------------------------------------------
// /dashboard — Operations overview. Browse people on /org; every employee
// page lives at /org/[id]. This page keeps the live operational widgets:
// recent failures, cross-department signals, and the activity rail.
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { getAllPersonas } from "@/lib/personas";
import ActivityRail from "@/components/activity-rail";
import NeedsAttention, { type Failure } from "@/components/needs-attention";
import SignalsFeed from "@/components/signals-feed";

interface RunLog {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  status: "success" | "error";
}

interface AgentSummary {
  agentId: string;
  name: string;
  lastRun: string;
  lastStatus: "success" | "error";
}

export default function DashboardPage() {
  const personas = getAllPersonas();

  const [agents, setAgents] = useState<AgentSummary[]>([]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/logs");
      const data = await res.json();
      const logs: RunLog[] = data.logs ?? [];
      const agentMap = new Map<string, AgentSummary>();
      for (const log of logs) {
        if (!agentMap.has(log.agentId)) {
          agentMap.set(log.agentId, {
            agentId: log.agentId,
            name: log.agentName.replace(/\s*\(.*\)$/, ""),
            lastRun: log.startedAt,
            lastStatus: log.status,
          });
        }
      }
      setAgents(Array.from(agentMap.values()));
    } catch {
      console.error("Failed to fetch logs");
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const personaById = useMemo(
    () => new Map(personas.map((p) => [p.agentId, p])),
    [personas]
  );

  // Employees whose most recent run failed.
  const failures = useMemo<Failure[]>(
    () =>
      agents
        .filter((a) => a.lastStatus === "error")
        .map((a) => ({
          agentId: a.agentId,
          name: personaById.get(a.agentId)?.name ?? a.name,
          when: a.lastRun,
        })),
    [agents, personaById]
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-slate-500 hover:text-skydeep transition-colors"
          >
            &larr; HQ
          </Link>
          <h2 className="font-display text-3xl font-bold uppercase tracking-wide">
            Operations <span className="text-skydeep">Overview</span>
          </h2>
        </div>
        <Link
          href="/review"
          className="px-4 py-2 bg-navy hover:bg-navy-deep text-white rounded-lg text-sm font-semibold transition-colors"
        >
          Open Review Queue
        </Link>
      </div>

      {/* Needs attention — recent failures */}
      <NeedsAttention failures={failures} />

      {/* Cross-department signals ticker (hidden while empty) */}
      <SignalsFeed />

      {/* Live activity rail */}
      <ActivityRail
        personas={personas}
        agents={agents.map((a) => ({ agentId: a.agentId, lastRun: a.lastRun }))}
      />

      {/* The people themselves live on the org chart */}
      <Link
        href="/org"
        className="lift block rounded-lg border border-line p-5 hover:border-sky/50 bg-panel/80"
      >
        <h3 className="font-semibold mb-1">Looking for the team?</h3>
        <p className="text-sm text-slate-500">
          Every employee lives on the org chart — click anyone to assign work,
          see their history, or open their chat console.
        </p>
      </Link>
    </div>
  );
}
