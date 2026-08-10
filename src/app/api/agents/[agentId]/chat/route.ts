// ---------------------------------------------------------------------------
// /api/agents/[agentId]/chat — talk to any (non-accounting) agent.
//   POST { mode: "chat", message } → { reply }
//   POST { mode: "history" }       → { messages }
//   POST { mode: "clear" }         → { ok }
// Signed-in staff only (the middleware login wall). Accounting agents use
// their own /api/accounting-manager/run chat; this rejects them.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { isChattable, runAgentConversation } from "@/lib/agent-chat";
import { loadAgentChat, clearAgentChat } from "@/lib/agent-chat-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await ctx.params;
  if (!isChattable(agentId)) {
    return NextResponse.json(
      { error: `${agentId} isn't available for chat here.` },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const mode = (body as { mode?: string }).mode ?? "chat";

  if (mode === "history") {
    const state = await loadAgentChat(agentId).catch(() => ({ messages: [] }));
    return NextResponse.json({ ok: true, messages: state.messages });
  }
  if (mode === "clear") {
    await clearAgentChat(agentId).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const { message, history = [], images = [], documents = [], files = [] } = body as {
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    images?: { mediaType?: string; data?: string }[];
    documents?: { name?: string; data?: string }[];
    files?: { name?: string; text?: string }[];
  };
  if (!message?.trim() && images.length === 0 && documents.length === 0 && files.length === 0) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Screenshots: at most 4, images only, ~4MB of base64 total (the client
  // downscales before sending; this is the backstop).
  const cleanImages = (Array.isArray(images) ? images : [])
    .filter(
      (i): i is { mediaType: string; data: string } =>
        typeof i?.mediaType === "string" &&
        i.mediaType.startsWith("image/") &&
        typeof i?.data === "string" &&
        i.data.length > 0
    )
    .slice(0, 4);
  // PDFs: at most 2, base64 only. Text files: at most 4, truncated hard.
  const cleanDocs = (Array.isArray(documents) ? documents : [])
    .filter(
      (d): d is { name: string; data: string } =>
        typeof d?.name === "string" && typeof d?.data === "string" && d.data.length > 0
    )
    .slice(0, 2)
    .map((d) => ({ name: d.name.slice(0, 120), data: d.data }));
  const cleanFiles = (Array.isArray(files) ? files : [])
    .filter(
      (f): f is { name: string; text: string } =>
        typeof f?.name === "string" && typeof f?.text === "string" && f.text.length > 0
    )
    .slice(0, 4)
    .map((f) => ({ name: f.name.slice(0, 120), text: f.text.slice(0, 400_000) }));

  const totalBytes =
    cleanImages.reduce((n, i) => n + i.data.length, 0) +
    cleanDocs.reduce((n, d) => n + d.data.length, 0) +
    cleanFiles.reduce((n, f) => n + f.text.length, 0);
  if (totalBytes > 5_500_000) {
    return NextResponse.json(
      { error: "Attachments too large — try fewer or smaller files." },
      { status: 413 }
    );
  }

  try {
    const result = await runAgentConversation(
      agentId,
      message?.trim() || "(see the attached file)",
      history,
      cleanImages,
      cleanDocs,
      cleanFiles
    );
    return NextResponse.json({ ok: true, reply: result.reply });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed." },
      { status: 500 }
    );
  }
}
