// ---------------------------------------------------------------------------
// org/ship-executors.ts — what "ship" actually DOES, per department
//
// The owner's approve trigger (shipWorkOrder) calls executeShip. At Summit,
// every department currently ships as a plain status change: the deliverable
// itself — a report, a lead list, an audit, a drafted email — IS the product.
// Outbound emails live inside the deliverable as fenced ```email blocks and
// are sent by a human, so shipping never touches an external system.
//
// When a department later gets a real side effect on ship (e.g. pushing an
// approved invoice into Zoho Books), add an executor here keyed off
// order.departmentId. Executors must never throw — a failed side effect
// shouldn't undo the ship.
// ---------------------------------------------------------------------------
import type { WorkOrder } from "./types";

/**
 * Run the department's ship executor. Returns a human-readable note about
 * what shipping did, or null when shipping is just the status change.
 */
export async function executeShip(order: WorkOrder): Promise<string | null> {
  try {
    // No department-specific executors wired yet — deliverables ship as-is.
    return null;
  } catch (err) {
    console.error(`[ship-executor] ${order.id} side effect failed:`, err);
    return `Ship recorded, but the follow-on automation failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}
