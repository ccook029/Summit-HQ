// ---------------------------------------------------------------------------
// GET /api/hq-metrics — the home page's org-status card.
//
// Live counts from the org engine's own state (Vercel KV): what's waiting on
// the owner, what shipped recently, and how busy the company has been. Every
// source is best-effort — a missing KV store degrades to zeros, not a 500.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { listWorkOrders, getOwnerQueue } from "@/lib/org/work-orders";
import { getRecentSignals } from "@/lib/signals";
import { getEmployees } from "@/lib/org/directory";

export const dynamic = "force-dynamic";

export async function GET() {
  const [orders, queue, signals] = await Promise.all([
    listWorkOrders({ limit: 200 }).catch(() => []),
    getOwnerQueue().catch(() => []),
    getRecentSignals(24 * 7).catch(() => []),
  ]);

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const shippedThisWeek = orders.filter(
    (o) =>
      o.status === "shipped" &&
      o.shippedAt &&
      new Date(o.shippedAt).getTime() >= weekAgo
  ).length;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    awaitingApproval: queue.filter((o) => o.status === "approved").length,
    escalations: queue.filter((o) => o.status === "escalated").length,
    shippedThisWeek,
    inProgress: orders.filter(
      (o) => o.status === "in_progress" || o.status === "in_review" || o.status === "queued"
    ).length,
    signalsThisWeek: signals.length,
    staffed: getEmployees().filter((e) => e.staffed && e.enabled).length,
  });
}
