// ---------------------------------------------------------------------------
// org/stage.ts — one plain-English vocabulary for "where does this sit?"
//
// The status machine in types.ts is precise but internal ("in_review",
// "revision"). This maps each status onto the question the owner is actually
// asking: WHO is holding this right now, and does it need me?
//
// Pure — no storage, no server imports — so the client pages and the API can
// both use it and never disagree about what a status means.
// ---------------------------------------------------------------------------
import type { WorkOrderStatus } from "./types";

/** Which lane of the board a status belongs to. */
export type StageLane = "team" | "boss" | "owner" | "done" | "problem";

export interface StageInfo {
  lane: StageLane;
  /** Short label for the badge. */
  label: string;
  /**
   * Who is holding the work. "assignee" / "manager" / "owner" / "nobody" —
   * the caller substitutes the real names from the directory.
   */
  holder: "assignee" | "manager" | "owner" | "nobody";
  /** One line explaining what happens next, written for the owner. */
  next: string;
  /** Tailwind classes for the badge. */
  tone: string;
  /**
   * True when the work is live and something should be moving it. If one of
   * these hasn't changed in a while, it stalled and needs a nudge.
   */
  live: boolean;
}

const STAGES: Record<WorkOrderStatus, StageInfo> = {
  queued: {
    lane: "team",
    label: "Not started",
    holder: "assignee",
    next: "Waiting to be picked up. Hit Run to start it now.",
    tone: "border-slate-300 text-slate-600",
    live: false,
  },
  in_progress: {
    lane: "team",
    label: "Drafting",
    holder: "assignee",
    next: "Writing the deliverable. Their boss reviews it next — no action from you.",
    tone: "border-sky-300 text-sky-700",
    live: true,
  },
  in_review: {
    lane: "boss",
    label: "Boss reviewing",
    holder: "manager",
    next: "The boss is deciding: approve, send back for changes, or escalate to you.",
    tone: "border-indigo-300 text-indigo-700",
    live: true,
  },
  revision: {
    lane: "team",
    label: "Sent back",
    holder: "assignee",
    next: "Redoing it with the feedback. It comes back through the boss again.",
    tone: "border-amber-300 text-amber-700",
    live: true,
  },
  approved: {
    lane: "owner",
    label: "Waiting on you",
    holder: "owner",
    next: "The boss signed off. Your approval in Review is what actually executes it.",
    tone: "border-emerald-300 text-emerald-700",
    live: false,
  },
  escalated: {
    lane: "owner",
    label: "Needs your answer",
    holder: "owner",
    next: "Blocked on a question only you can answer. Answer it in Review, then send it back.",
    tone: "border-amber-400 text-amber-700",
    live: false,
  },
  shipped: {
    lane: "done",
    label: "Done",
    holder: "nobody",
    next: "You approved it and it executed.",
    tone: "border-emerald-400 text-emerald-700",
    live: false,
  },
  rejected: {
    lane: "done",
    label: "Killed",
    holder: "nobody",
    next: "You rejected it. Nothing further happens.",
    tone: "border-slate-300 text-slate-500",
    live: false,
  },
  error: {
    lane: "problem",
    label: "Errored",
    holder: "nobody",
    next: "The run failed partway. Retry picks it up from the top.",
    tone: "border-red-300 text-red-700",
    live: false,
  },
};

export function stageOf(status: string): StageInfo {
  return STAGES[status as WorkOrderStatus] ?? STAGES.queued;
}

/** How long a status is expected to hold before it's suspicious (minutes). */
export const STALL_MINUTES = 12;
