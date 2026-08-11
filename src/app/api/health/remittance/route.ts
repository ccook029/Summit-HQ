// ---------------------------------------------------------------------------
// GET /api/health/remittance — what the remittance attachment pull actually
// retrieved, without running an agent. Sizes only, never file contents.
// Behind the login wall like everything else.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { getRemittanceAttachments } from "@/lib/zoho-mail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const bundle = await getRemittanceAttachments();
    return NextResponse.json({
      ok: true,
      note: bundle.note,
      documents: bundle.documents.map((d) => ({
        name: d.name,
        approxKB: Math.round((d.data.length * 0.75) / 1024),
      })),
      extracts: bundle.extracts.map((e) => ({
        name: e.name,
        chars: e.text.length,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
