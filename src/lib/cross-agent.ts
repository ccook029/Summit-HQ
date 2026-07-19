// ---------------------------------------------------------------------------
// cross-agent.ts — the "agents inform each other" glue (audit item #11).
//
// Every agent chat gets a digest of what the OTHER agents/tools reported
// recently (from the shared signals store), so e.g. the Controller can factor
// in what Operations just committed to — without any point-to-point wiring. Empty until agents start posting signals.
// ---------------------------------------------------------------------------
import { getRecentSignals } from "./signals";

export async function renderCrossAgentSignals(
  excludeSource?: string
): Promise<string> {
  const signals = await getRecentSignals().catch(() => []);
  const relevant = signals
    .filter((s) => !excludeSource || s.source !== excludeSource)
    .slice(0, 12);
  if (relevant.length === 0) return "";
  return [
    "",
    "=== WHAT OTHER SUMMIT AGENTS & TOOLS REPORTED (last 24h) ===",
    "Cross-reference these when they're relevant to the question — this is how",
    "the company's agents stay aware of each other.",
    ...relevant.map(
      (s) => `- [${s.source}] ${s.headline}${s.detail ? ` — ${s.detail}` : ""}`
    ),
    "=== END CROSS-AGENT SIGNALS ===",
  ].join("\n");
}
