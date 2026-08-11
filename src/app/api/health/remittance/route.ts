// ---------------------------------------------------------------------------
// GET /api/health/remittance — what the remittance attachment pull actually
// retrieved, without running an agent. Sizes only, never file contents.
// Behind the login wall like everything else.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import {
  getRemittanceAttachments,
  clearProcessedRemittances,
  countProcessedRemittances,
} from "@/lib/zoho-mail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    // ?reset=1 clears the "already read" ledger so the next sweep re-reads
    // everything from scratch.
    if (new URL(request.url).searchParams.get("reset") === "1") {
      await clearProcessedRemittances();
      return NextResponse.json({ ok: true, reset: true, processedRemaining: 0 });
    }
    const bundle = await getRemittanceAttachments({ skipProcessed: true, dryRun: true });
    return NextResponse.json({
      ok: true,
      note: bundle.note,
      documents: bundle.documents.map((d) => ({
        name: d.name,
        approxKB: Math.round((d.data.length * 0.75) / 1024),
      })),
      images: bundle.images.map((i) => ({
        name: i.name,
        approxKB: Math.round((i.data.length * 0.75) / 1024),
      })),
      extracts: bundle.extracts.map((e) => ({
        name: e.name,
        chars: e.text.length,
      })),
      alreadyReadInPriorSweeps: await countProcessedRemittances(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
