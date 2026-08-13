// ---------------------------------------------------------------------------
// org/work-orders.ts — Work-order store (Vercel KV)
//
// A work order is the Org OS unit of work: brief → worker draft → boss review
// → owner trigger. This module is pure storage + status transitions; the
// engine (org/engine.ts) drives the actual Claude calls.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import type { OrderAttachment, WorkOrder, WorkOrderStatus } from "./types";

const KEY = "org-work-orders";
const MAX_WORK_ORDERS = 400;

/** Transitions the store will accept — everything else is a bug upstream. */
const ALLOWED: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  queued: ["in_progress", "rejected"],
  // "queued" on the two live states is the resume path: a run killed by the
  // serverless ceiling leaves the order here with nobody driving it.
  // "rejected" is the owner's cancel — available from every live state, since
  // a stalled order is exactly the one you're most likely to want gone.
  in_progress: ["in_review", "approved", "escalated", "error", "queued", "rejected"],
  in_review: ["revision", "approved", "escalated", "error", "queued", "rejected"],
  revision: ["in_progress", "rejected"],
  approved: ["shipped", "revision", "rejected"],
  escalated: ["revision", "approved", "rejected"],
  shipped: [],
  rejected: [],
  error: ["in_progress", "rejected"],
};

async function loadAll(): Promise<WorkOrder[]> {
  return (await kv.get<WorkOrder[]>(KEY)) ?? [];
}

async function saveAll(orders: WorkOrder[]): Promise<void> {
  await kv.set(KEY, orders.slice(-MAX_WORK_ORDERS));
}

export async function createWorkOrder(input: {
  departmentId: string;
  assigneeId: string;
  title: string;
  brief: string;
  deliverableType?: string;
  createdBy?: string;
  attachments?: OrderAttachment[];
  context?: Record<string, string>;
}): Promise<WorkOrder> {
  const now = new Date().toISOString();
  const order: WorkOrder = {
    id: `wo-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    departmentId: input.departmentId,
    assigneeId: input.assigneeId,
    title: input.title.trim(),
    brief: input.brief.trim(),
    deliverableType: input.deliverableType?.trim() || "report",
    status: "queued",
    createdBy: input.createdBy ?? "Chris Cook",
    createdAt: now,
    updatedAt: now,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.context && Object.keys(input.context).length
      ? { context: input.context }
      : {}),
    rounds: [],
    reviews: [],
    escalationIds: [],
  };
  const all = await loadAll();
  await saveAll([...all, order]);
  return order;
}

export async function getWorkOrder(id: string): Promise<WorkOrder | null> {
  return (await loadAll()).find((o) => o.id === id) ?? null;
}

export async function listWorkOrders(filter?: {
  departmentId?: string;
  assigneeId?: string;
  status?: WorkOrderStatus | WorkOrderStatus[];
  limit?: number;
}): Promise<WorkOrder[]> {
  const statuses = filter?.status
    ? new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
    : null;
  return (await loadAll())
    .filter(
      (o) =>
        (!filter?.departmentId || o.departmentId === filter.departmentId) &&
        (!filter?.assigneeId || o.assigneeId === filter.assigneeId) &&
        (!statuses || statuses.has(o.status))
    )
    .reverse() // newest first
    .slice(0, filter?.limit ?? 100);
}

/**
 * Apply a patch to a work order, enforcing the status machine when the patch
 * changes status. Returns the updated order, or null if not found.
 */
export async function updateWorkOrder(
  id: string,
  patch: Partial<Omit<WorkOrder, "id" | "createdAt">>
): Promise<WorkOrder | null> {
  const all = await loadAll();
  const idx = all.findIndex((o) => o.id === id);
  if (idx === -1) return null;

  const current = all[idx];
  if (patch.status && patch.status !== current.status) {
    if (!ALLOWED[current.status].includes(patch.status)) {
      throw new Error(
        `Invalid work-order transition: ${current.status} → ${patch.status} (${id})`
      );
    }
  }

  all[idx] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await saveAll(all);
  return all[idx];
}

/** Work waiting on the owner: boss-approved deliverables + escalated orders. */
/**
 * Return a stalled order to the queue so it can be re-run. A run that dies
 * mid-flight (serverless timeout, dropped connection) leaves the order stuck
 * in in_progress/in_review with no way forward — this is that way forward.
 */
export async function resumeWorkOrder(id: string): Promise<WorkOrder | null> {
  const order = await getWorkOrder(id);
  if (!order) return null;
  if (order.status !== "in_progress" && order.status !== "in_review") {
    throw new Error(
      `Work order ${id} is "${order.status}" — only a stalled in-progress order needs resuming.`
    );
  }
  return updateWorkOrder(id, { status: "queued", error: undefined });
}

export async function getOwnerQueue(): Promise<WorkOrder[]> {
  return listWorkOrders({ status: ["approved", "escalated"] });
}
