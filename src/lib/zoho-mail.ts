// ---------------------------------------------------------------------------
// zoho-mail.ts — read-only Zoho Mail access for the Finance team.
//
// Purpose: surface likely REMITTANCE emails (customers saying "we paid
// invoice X") so the Bookkeeper can match them against open invoices in
// Books. Read-only: this module never sends, moves, or deletes mail.
//
// Auth: the same shared OAuth flow as Books (zoho.ts). The refresh token
// must include ZohoMail.messages.READ and ZohoMail.accounts.READ — the
// /setup/zoho wizard's combined scope covers it.
//
// Data center: the Mail API lives on mail.zoho.* hosts. Derived from
// ZOHO_ACCOUNTS_URL, overridable with ZOHO_MAIL_DOMAIN.
// ---------------------------------------------------------------------------
import { getAccessToken, invalidateTokenCache } from "./zoho";

function mailDomain(): string {
  if (process.env.ZOHO_MAIL_DOMAIN) return process.env.ZOHO_MAIL_DOMAIN;
  const accounts = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";
  return accounts
    .replace("accounts.zohocloud.ca", "mail.zohocloud.ca")
    .replace("accounts.zoho.", "mail.zoho.");
}

async function mailGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${mailDomain()}/api${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) await invalidateTokenCache();
    throw new Error(`Zoho Mail ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface MailMessage {
  messageId: string;
  folderId: string;
  subject: string;
  from: string;
  receivedTime: string; // ISO-ish
  summary: string;
  hasAttachment: boolean;
}

interface RawMessage {
  messageId?: string | number;
  folderId?: string | number;
  subject?: string;
  fromAddress?: string;
  sender?: string;
  receivedTime?: string | number;
  summary?: string;
  hasAttachment?: string | number | boolean;
}

/** The primary Mail account id (first account on the token's user). */
async function getAccountId(): Promise<string> {
  const res = await mailGet<{ data?: { accountId?: string | number }[] }>("/accounts");
  const id = res.data?.[0]?.accountId;
  if (!id) throw new Error("No Zoho Mail account visible to this token — is ZohoMail.accounts.READ in the scope?");
  return String(id);
}

function toMessage(m: RawMessage): MailMessage {
  return {
    messageId: String(m.messageId ?? ""),
    folderId: String(m.folderId ?? ""),
    subject: m.subject ?? "(no subject)",
    from: m.fromAddress ?? m.sender ?? "",
    receivedTime: String(m.receivedTime ?? ""),
    summary: m.summary ?? "",
    hasAttachment:
      m.hasAttachment === true || m.hasAttachment === "1" || m.hasAttachment === 1,
  };
}

async function mailGetBinary(path: string): Promise<ArrayBuffer> {
  const token = await getAccessToken();
  const res = await fetch(`${mailDomain()}/api${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) await invalidateTokenCache();
    throw new Error(`Zoho Mail ${path} failed (${res.status})`);
  }
  return res.arrayBuffer();
}

/** Latest inbox messages (metadata only), single page. */
export async function fetchRecentMessages(limit = 50, start = 1): Promise<MailMessage[]> {
  const accountId = await getAccountId();
  const res = await mailGet<{ data?: RawMessage[] }>(
    `/accounts/${accountId}/messages/view?limit=${Math.min(limit, 200)}&start=${start}`
  );
  return (res.data ?? []).map(toMessage);
}

/**
 * Walk the inbox backwards until messages get older than `days` (or the page
 * cap is hit). Zoho's receivedTime is epoch millis.
 */
export async function fetchMessagesSince(
  days: number,
  maxPages = 10
): Promise<{ messages: MailMessage[]; exhausted: boolean }> {
  const accountId = await getAccountId();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const out: MailMessage[] = [];
  let start = 1;
  for (let page = 0; page < maxPages; page++) {
    const res = await mailGet<{ data?: RawMessage[] }>(
      `/accounts/${accountId}/messages/view?limit=200&start=${start}`
    );
    const rows = (res.data ?? []).map(toMessage);
    if (rows.length === 0) return { messages: out, exhausted: true };
    for (const m of rows) {
      const t = Number(m.receivedTime);
      if (Number.isFinite(t) && t < cutoff) return { messages: out, exhausted: true };
      out.push(m);
    }
    if (rows.length < 200) return { messages: out, exhausted: true };
    start += 200;
  }
  return { messages: out, exhausted: false };
}

const REMIT_PATTERN =
  /remit|payment|paid|e-?transfer|etransfer|eft|wire|deposit|invoice|cheque|check\b/i;

/**
 * Likely remittance emails, rendered for prompt injection with an explicit
 * coverage statement (what window was scanned, what was found, what was
 * shown) so the agent never has to guess why a list ends where it does.
 * Best-effort: any failure returns a plain-text note.
 */
export async function renderRemittanceCandidates(
  opts: { days?: number; max?: number } = {}
): Promise<string> {
  const days = opts.days ?? 90;
  const max = opts.max ?? 40;
  const { messages, exhausted } = await fetchMessagesSince(days);
  const candidates = messages.filter((m) =>
    REMIT_PATTERN.test(`${m.subject} ${m.summary}`)
  );
  const shown = candidates.slice(0, max);
  const fmt = (ms: string) => {
    const t = Number(ms);
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ms;
  };
  const coverage = `COVERAGE: scanned ${messages.length} inbox messages over the last ~${days} days${exhausted ? "" : " (page cap hit — older mail exists beyond this scan)"}; ${candidates.length} look remittance-like; showing ${shown.length}. Mail older than this window is NOT in this list — say so rather than concluding it doesn't exist.`;
  if (shown.length === 0) return `${coverage}\n(no likely remittance emails found in that window)`;
  return [
    coverage,
    ...shown.map(
      (m) => `- [${fmt(m.receivedTime)}] FROM ${m.from} — "${m.subject}" — ${m.summary.slice(0, 160)}`
    ),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Remittance attachments — the actual payment detail usually lives in a PDF
// or spreadsheet attached to the remittance email, not in its body. This
// pulls attachments off the remittance-like messages: PDFs come back as
// base64 documents (Claude reads them natively), CSV/XLSX/TXT come back as
// extracted text. Everything is capped so a prompt can carry it.
// ---------------------------------------------------------------------------

export interface MailAttachmentDoc {
  name: string;
  data: string; // base64 PDF
}
export interface MailAttachmentText {
  name: string;
  text: string;
}
export interface RemittanceAttachmentBundle {
  documents: MailAttachmentDoc[];
  extracts: MailAttachmentText[];
  note: string;
}

interface AttachmentInfo {
  attachmentId?: string | number;
  attachmentName?: string;
  attachmentSize?: string | number;
}

const MAX_PDF_BYTES = 4_500_000;
const MAX_EXTRACT_CHARS = 40_000;

export async function getRemittanceAttachments(
  opts: { days?: number; maxDocs?: number; maxExtracts?: number; maxMessages?: number } = {}
): Promise<RemittanceAttachmentBundle> {
  const days = opts.days ?? 90;
  const maxDocs = opts.maxDocs ?? 6;
  const maxExtracts = opts.maxExtracts ?? 6;
  const maxMessages = opts.maxMessages ?? 14;

  const { messages } = await fetchMessagesSince(days);
  // NOTE: do NOT filter on hasAttachment — Zoho omits/zeroes that flag on
  // some listings, which silently hid real attachments. Ask every
  // remittance-like message for its attachment info instead; messages that
  // genuinely have none simply return an empty list.
  const candidates = messages
    .filter((m) => REMIT_PATTERN.test(`${m.subject} ${m.summary}`))
    .sort((a, b) => Number(b.hasAttachment) - Number(a.hasAttachment))
    .slice(0, maxMessages);

  const accountId = await getAccountId();
  const documents: MailAttachmentDoc[] = [];
  const extracts: MailAttachmentText[] = [];
  const notes: string[] = [];

  const fmt = (ms: string) => {
    const t = Number(ms);
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ms;
  };

  const perMessage: string[] = [];
  for (const msg of candidates) {
    if (documents.length >= maxDocs && extracts.length >= maxExtracts) break;
    try {
      const info = await mailGet<{ data?: { attachments?: AttachmentInfo[] } }>(
        `/accounts/${accountId}/folders/${msg.folderId}/messages/${msg.messageId}/attachmentinfo`
      );
      const found = info.data?.attachments ?? [];
      if (found.length > 0) {
        perMessage.push(
          `"${msg.subject}" (${fmt(msg.receivedTime)}): ${found.map((f) => f.attachmentName ?? "?").join(", ")}`
        );
      }
      for (const a of found) {
        const name = a.attachmentName ?? "attachment";
        const label = `${fmt(msg.receivedTime)} · ${msg.from} · ${name}`;
        const ext = name.toLowerCase().split(".").pop() ?? "";
        const size = Number(a.attachmentSize ?? 0);
        const path = `/accounts/${accountId}/folders/${msg.folderId}/messages/${msg.messageId}/attachments/${a.attachmentId}`;

        if (ext === "pdf") {
          if (documents.length >= maxDocs) continue;
          if (size > MAX_PDF_BYTES) {
            notes.push(`skipped ${label} (PDF over 2.5MB)`);
            continue;
          }
          const buf = await mailGetBinary(path);
          documents.push({ name: label, data: Buffer.from(buf).toString("base64") });
        } else if (["csv", "tsv", "txt"].includes(ext)) {
          if (extracts.length >= maxExtracts) continue;
          const buf = await mailGetBinary(path);
          const text = new TextDecoder().decode(buf).slice(0, MAX_EXTRACT_CHARS);
          if (text.trim()) extracts.push({ name: label, text });
        } else if (["xlsx", "xls"].includes(ext)) {
          if (extracts.length >= maxExtracts) continue;
          const buf = await mailGetBinary(path);
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buf, { type: "array" });
          const parts: string[] = [];
          for (const sheetName of wb.SheetNames.slice(0, 4)) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]).trim();
            if (csv) parts.push(`--- sheet: ${sheetName} ---\n${csv}`);
          }
          const text = parts.join("\n\n").slice(0, MAX_EXTRACT_CHARS);
          if (text.trim()) extracts.push({ name: label, text });
        } else {
          notes.push(`skipped ${label} (unsupported type .${ext})`);
        }
      }
    } catch (err) {
      notes.push(
        `could not read attachments of "${msg.subject}" (${err instanceof Error ? err.message.slice(0, 80) : "error"})`
      );
    }
  }

  const note = [
    `ATTACHMENTS PULLED: ${documents.length} PDF${documents.length === 1 ? "" : "s"} (given to you as readable documents) and ${extracts.length} spreadsheet/text extract${extracts.length === 1 ? "" : "s"}, from ${candidates.length} remittance-like emails checked.`,
    perMessage.length
      ? `Attachments found per email — ${perMessage.join(" | ")}.`
      : "No attachments were found on any checked email.",
    documents.length > 0
      ? `The PDFs above are attached to this message IN ORDER: ${documents.map((d, i) => `[${i + 1}] ${d.name}`).join("; ")}. Read EVERY one before answering, and state per document what you could and could not extract.`
      : "",
    notes.length ? `Problems: ${notes.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { documents, extracts, note };
}

export function mailConfigured(): boolean {
  // Mail rides on the same OAuth env as Books; the scope decides access.
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN
  );
}
