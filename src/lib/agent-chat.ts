// ---------------------------------------------------------------------------
// agent-chat.ts — talk to any agent or org employee.
//
// Employees chat with their persona/system prompt,
// the shared company knowledge, and their own most-recent reports.
//
// Org employees chat with their employee-config prompt +
// live department context. Department BOSSES additionally get their team's
// recent work orders and scheduled reports as grounding, so Chris can ask
// "give me the high level on Sage's SEO findings" and drill down from there —
// and they can hand out agreed work straight from the chat via ```assign
// blocks (the UI turns each into a one-click "Assign & run" card).
// ---------------------------------------------------------------------------
import { callClaude } from "./anthropic";
import { CLAUDE_MODEL, CLAUDE_MANAGER_MODEL } from "./models";
import { getRunLogsByAgent } from "./store";
import { renderOrgKnowledge } from "./org-knowledge";
import { getRemittanceAttachments } from "./zoho-mail";
import {
  matchOpenCustomersInText,
  renderCustomerArLedger,
} from "./zoho-books";
import { renderCrossAgentSignals } from "./cross-agent";
import { loadAgentChat, appendAgentChat } from "./agent-chat-store";
import {
  getEmployeeById,
  getDepartmentById,
  getDirectReports,
} from "./org/directory";
import {
  getEmployeeProfile,
  buildDefaultSystemPrompt,
} from "./org/employee-configs";
import { renderDepartmentContext } from "./org/department-context";
import { listWorkOrders } from "./org/work-orders";
import type { Employee, WorkOrder } from "./org/types";

// Agents with a dedicated, richer chat surface of their own — the generic
// path stays out of their way.
const DEDICATED = new Set(["accounting-manager", "accounting", "product-design"]);

export function isChattable(agentId: string): boolean {
  if (DEDICATED.has(agentId)) return false;
  const employee = getEmployeeById(agentId);
  return Boolean(employee && employee.staffed && employee.enabled);
}

export interface AgentChatTurn {
  reply: string;
}

function trimmedDraft(order: WorkOrder, chars: number): string {
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "";
  return draft.trim().slice(0, chars);
}

function renderOrders(orders: WorkOrder[], fullChars: number): string {
  return orders
    .map((o, i) => {
      const head = `- [${o.status}] "${o.title}" (${o.updatedAt.slice(0, 10)})`;
      // Full text for the most recent order, one-line preview for older ones.
      const body =
        i === 0
          ? trimmedDraft(o, fullChars)
          : trimmedDraft(o, 240).replace(/\s+/g, " ");
      return body ? `${head}\n${body}` : head;
    })
    .join("\n\n");
}

/** The boss's grounding: what each direct report has produced lately —
 * their work orders through the engine AND their scheduled-run reports. */
async function renderTeamWork(reports: Employee[]): Promise<string> {
  const sections = await Promise.all(
    reports.map(async (member) => {
      const [orders, logs] = await Promise.all([
        listWorkOrders({ assigneeId: member.id, limit: 3 }).catch(() => []),
        getRunLogsByAgent(member.id).catch(() => []),
      ]);
      const parts: string[] = [];
      if (orders.length) parts.push(renderOrders(orders, 2600));
      for (const log of logs.slice(0, 2)) {
        parts.push(
          `- [scheduled report, ${log.status}] ${log.startedAt.slice(0, 10)}\n${log.output.slice(0, 2600)}`
        );
      }
      if (!parts.length) return `### ${member.name} — ${member.title}\n(nothing produced yet)`;
      return `### ${member.name} — ${member.title} (id: ${member.id})\n${parts.join("\n\n")}`;
    })
  );
  return sections.join("\n\n---\n\n");
}

function assignProtocol(reports: Employee[]): string {
  const roster = reports
    .map((r) => `  - ${r.id} — ${r.name}, ${r.title}`)
    .join("\n");
  return `## Handing out work from this chat
When the discussion lands on something your team should produce, end your reply with ONE fenced block per piece of work:
\`\`\`assign
{ "assignee": "<employee-id>", "title": "<short title>", "brief": "<the full brief — specific enough to execute without guessing, folding in everything agreed in this chat>" }
\`\`\`
Your team (use these exact ids):
${roster}
The founder confirms each block with one click, which runs the full worker → your-review cycle and lands the result in their Review queue. Don't emit an assign block for hypotheticals — only when the work is actually wanted. Never put anything after the assign block(s).`;
}

export interface ChatImage {
  mediaType: string;
  data: string; // base64, no data: prefix
}

export interface ChatDocument {
  name: string;
  data: string; // base64 PDF, no data: prefix
}

export interface ChatTextFile {
  name: string;
  text: string; // extracted text (CSV from a spreadsheet, etc.)
}

export async function runAgentConversation(
  agentId: string,
  message: string,
  clientHistory: { role: "user" | "assistant"; content: string }[] = [],
  images: ChatImage[] = [],
  documents: ChatDocument[] = [],
  textFiles: ChatTextFile[] = []
): Promise<AgentChatTurn> {
  const employee = getEmployeeById(agentId);
  if (!employee) throw new Error(`Unknown agent: ${agentId}`);

  const department = employee ? getDepartmentById(employee.departmentId) : undefined;
  const teamReports = employee
    ? getDirectReports(employee.id).filter((r) => r.staffed && r.enabled)
    : [];
  const isManager = teamReports.length > 0;
  const name = employee.name;

  const stored = await loadAgentChat(agentId).catch(() => ({ messages: [] }));
  const history = stored.messages.length ? stored.messages : clientHistory;

  const logs = await getRunLogsByAgent(agentId).catch(() => []);
  const reports =
    logs
      .slice(0, 3)
      .map(
        (l) =>
          `### ${l.agentName} — ${l.startedAt.slice(0, 10)} (${l.status})\n${l.output.slice(0, 4000)}`
      )
      .join("\n\n---\n\n") || "(no reports produced yet — say what you'd run to find out)";

  const historyBlock =
    history
      .slice(-12)
      .filter((m) => m.content.trim())
      .map((m) => `${m.role === "user" ? "Team" : name}: ${m.content.slice(0, 1500)}`)
      .join("\n\n") || "(no prior messages)";

  // Base persona: the org prompt profile, then the synthesized default
  // from the directory.
  const profile = employee ? getEmployeeProfile(employee.id) : undefined;
  const basePrompt =
    profile?.systemPrompt ??
    profile?.managerSystemPrompt ??
    buildDefaultSystemPrompt(employee!, department!);

  const systemPrompt =
    basePrompt +
    (await renderOrgKnowledge().catch(() => "")) +
    (await renderCrossAgentSignals(agentId).catch(() => ""));

  // Finance chats carry the remittance email attachments (PDFs as readable
  // documents, sheets as text) so "read the attachment" just works.
  let mailDocs: ChatDocument[] = [];
  let mailImages: ChatImage[] = [];
  let mailExtractBlock = "";
  if (employee.departmentId === "finance") {
    // "Just look at Future Transfer" should change WHICH mail is fetched,
    // not merely be advice the employee can't act on.
    const named = await matchOpenCustomersInText(message).catch(() => [] as string[]);
    const bundle = await getRemittanceAttachments({
      maxDocs: 3,
      maxExtracts: named.length ? 40 : 12,
      maxImages: 3,
      maxMessages: named.length ? 120 : 30,
      filterTerms: named,
    }).catch(() => null);
    if (bundle) {
      mailDocs = bundle.documents.map((d) => ({ name: d.name, data: d.data }));
      mailImages = bundle.images.map((i) => ({ mediaType: i.mediaType, data: i.data }));
      const extracts = bundle.extracts
        .map((e) => `### Attachment: ${e.name}\n\`\`\`\n${e.text}\n\`\`\``)
        .join("\n\n");
      mailExtractBlock = `\n\n## Remittance email attachments\n${bundle.note}${extracts ? `\n\n${extracts}` : ""}`;
    }
    if (named.length > 0) {
      const ledger = await renderCustomerArLedger(named).catch(() => "");
      if (ledger) mailExtractBlock += `\n\n${ledger}`;
    }
  }

  // Org grounding: live department data, own work orders, and — for bosses —
  // everything the team has produced lately.
  let orgBlocks = "";
  if (employee) {
    const [deptContext, ownOrders, teamWork] = await Promise.all([
      renderDepartmentContext(employee).catch(() => ""),
      listWorkOrders({ assigneeId: employee.id, limit: 4 }).catch(() => []),
      isManager ? renderTeamWork(teamReports) : Promise.resolve(""),
    ]);
    if (deptContext) orgBlocks += `\n\n${deptContext}`;
    if (ownOrders.length)
      orgBlocks += `\n\n## Your recent work orders\n${renderOrders(ownOrders, 2600)}`;
    if (teamWork)
      orgBlocks += `\n\n## Your team's recent work (you have already read all of this)\n${teamWork}`;
  }

  const managerGuidance = isManager
    ? `\n\nYou are the department boss. When asked about your team's work, LEAD WITH THE HIGH LEVEL — the few findings or takeaways that matter, in a handful of tight sentences — and offer the threads worth pulling. Do NOT re-dump a report; the founder can drill down by asking. Have a point of view: what you'd act on, what you'd skip, and why.\n\n${assignProtocol(teamReports)}`
    : "";

  const imageNote = images.length
    ? `\n\nThey attached ${images.length} screenshot${images.length > 1 ? "s" : ""} (shown to you above the text) — look at ${images.length > 1 ? "them" : "it"} carefully; ${images.length > 1 ? "they are" : "it is"} what they're talking about.`
    : "";
  const docNote = documents.length
    ? `\n\nThey attached ${documents.length} PDF${documents.length > 1 ? "s" : ""} (provided above the text) — read ${documents.length > 1 ? "them" : "it"} carefully.`
    : "";
  if (mailExtractBlock) orgBlocks += mailExtractBlock;

  const fileBlock = textFiles.length
    ? `\n\n## Attached files (extracted contents)\n${textFiles
        .map((f) => `### ${f.name}\n\`\`\`\n${f.text}\n\`\`\``)
        .join("\n\n")}`
    : "";

  const userMessage = `You are ${name}, chatting live with the Summit team (usually Chris, the owner). Answer their message directly and specifically, grounded in your recent work below and what you know about Summit. If you don't have the data, say exactly what you'd run or need — don't invent numbers. Keep it conversational and tight; this is a chat, not an email.${managerGuidance}${imageNote}${docNote}${fileBlock}

## Your most recent reports
${reports}${orgBlocks}

## Conversation so far
${historyBlock}

## Their message
${message}`;

  const model = employee.model ?? (isManager ? CLAUDE_MANAGER_MODEL : CLAUDE_MODEL);
  let res = await callClaude({
    systemPrompt,
    userMessage,
    model,
    maxTokens: 6144,
    temperature: 0.4,
    images: [...mailImages, ...images],
    documents: [...mailDocs, ...documents],
  });
  // Rarely the API 200s with no text (observed in production as a ghost
  // bubble). Retry once; if it's still empty, fail loudly so the UI shows a
  // real error instead of silence.
  if (!res.text.trim()) {
    console.warn(
      `[agent-chat] empty reply from ${model} for ${agentId} (in=${res.inputTokens}, out=${res.outputTokens}) — retrying once`
    );
    res = await callClaude({
      systemPrompt,
      userMessage,
      model,
      maxTokens: 8192,
      temperature: 0.4,
      images: [...mailImages, ...images],
      documents: [...mailDocs, ...documents],
    });
    if (!res.text.trim()) {
      throw new Error(`${name} came back empty twice (model ${model}, stop_reason ${res.stopReason ?? "unknown"}, ${res.outputTokens} output tokens). If stop_reason is max_tokens the reply budget is still too small — tell Claude.`);
    }
  }

  // The stored transcript is text-only — note the attachment instead of
  // persisting base64 blobs into KV.
  const attachmentNames = [
    ...documents.map((d) => d.name),
    ...textFiles.map((f) => f.name),
  ];
  const noteParts = [
    images.length ? `${images.length} screenshot${images.length > 1 ? "s" : ""}` : "",
    attachmentNames.length ? attachmentNames.join(", ") : "",
  ].filter(Boolean);
  const storedMessage = noteParts.length
    ? `[attached: ${noteParts.join("; ")}] ${message}`
    : message;
  await appendAgentChat(agentId, storedMessage, res.text).catch(() => {});
  return { reply: res.text };
}
