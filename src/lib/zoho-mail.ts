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
}

interface RawMessage {
  messageId?: string | number;
  folderId?: string | number;
  subject?: string;
  fromAddress?: string;
  sender?: string;
  receivedTime?: string | number;
  summary?: string;
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
  };
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

export function mailConfigured(): boolean {
  // Mail rides on the same OAuth env as Books; the scope decides access.
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN
  );
}
