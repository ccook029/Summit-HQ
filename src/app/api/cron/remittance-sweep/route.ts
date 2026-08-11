// ---------------------------------------------------------------------------
// GET /api/cron/remittance-sweep — the weekly (Monday) remittance sweep.
//
// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET` (the
// middleware lets that bearer through; this route verifies it too).
//
// Behaviour:
//   1. Peek at the mailbox WITHOUT consuming the processed ledger. If there
//      is nothing new to read, do nothing — no work order, no tokens burned,
//      no noise in the owner's queue.
//   2. Otherwise create a Bookkeeper work order with the standing sweep brief
//      and run the full worker → Controller review cycle. Whatever the
//      Controller approves lands in /review, where the owner's approval is
//      still what records payments in Zoho Books.
//
// Manual trigger (same behaviour) is a POST from a signed-in session.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { createWorkOrder } from "@/lib/org/work-orders";
import { runWorkOrder } from "@/lib/org/engine";
import { getRemittanceAttachments } from "@/lib/zoho-mail";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const SWEEP_BRIEF =
  "Work every remittance email available to you, not just the newest. For EACH one: read its attachments (the PDF/image/spreadsheet carries the payer's invoice references and amounts), find the matching open invoice in the A/R detail table, and confirm payer, amount, and reference agree. " +
  "Put every confident match in ONE `payment` block with its evidence — those are applied to Zoho Books when the owner approves this order. " +
  "This sweep is INCREMENTAL and covers the WHOLE mailbox history, oldest unread remittances included: attachments handed to you in earlier sweeps are not re-sent, so work what you have now and expect the remaining backlog on the next run. " +
  "THE POINT OF THIS JOB is clearing OPEN invoices. Old mail whose invoice was already settled, and vendor bills addressed to Summit, are EXPECTED to yield nothing — give each a single line and move on; do not write long analyses of them. " +
  "Keep the deliverable short when there is nothing to apply: state the empty payment block, list in one line each what you looked at and why it did not match, then (a) anything you could not match that LOOKS like it should have, (b) any amount that disagrees with an invoice balance, and (c) the coverage line you were given, including how many emails remain unchecked. Never guess an invoice number. " +
  "If, after reading, some OPEN invoices look paid but you have no remittance for them, list those invoice numbers — that tells the owner where to look next.";

async function runSweep(trigger: string) {
  // Peek first: dryRun means nothing is recorded as read, so this check
  // never consumes work the sweep itself should do.
  const peek = await getRemittanceAttachments({
    maxDocs: 1,
    maxExtracts: 1,
    maxImages: 1,
    maxMessages: 60,
    skipProcessed: true,
    dryRun: true,
  }).catch(() => null);

  const found =
    (peek?.documents.length ?? 0) +
    (peek?.images.length ?? 0) +
    (peek?.extracts.length ?? 0);

  if (!peek) {
    return { ran: false, reason: "Mailbox unreachable this run." };
  }
  if (found === 0) {
    return { ran: false, reason: "Nothing new in the mailbox — no work order created." };
  }

  const order = await createWorkOrder({
    departmentId: "finance",
    assigneeId: "bookkeeper",
    title: `Weekly remittance sweep — ${new Date().toISOString().slice(0, 10)}`,
    brief: SWEEP_BRIEF,
    deliverableType: "remittance-match",
    createdBy: trigger,
  });

  const { order: done } = await runWorkOrder(order.id);

  await postSignal({
    source: "finance",
    headline:
      done.status === "approved"
        ? `Remittance sweep finished — awaiting your approval in Review.`
        : `Remittance sweep finished with status "${done.status}".`,
  }).catch(() => {});

  return { ran: true, orderId: done.id, status: done.status };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runSweep("Scheduled sweep")) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/** Manual "run it now" from a signed-in session (the middleware guards this). */
export async function POST() {
  try {
    return NextResponse.json({ ok: true, ...(await runSweep("Manual sweep")) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
