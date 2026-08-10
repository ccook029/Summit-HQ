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

/** Latest inbox messages (metadata only). */
export async function fetchRecentMessages(limit = 50): Promise<MailMessage[]> {
  const accountId = await getAccountId();
  const res = await mailGet<{ data?: RawMessage[] }>(
    `/accounts/${accountId}/messages/view?limit=${Math.min(limit, 200)}`
  );
  return (res.data ?? []).map((m) => ({
    messageId: String(m.messageId ?? ""),
    folderId: String(m.folderId ?? ""),
    subject: m.subject ?? "(no subject)",
    from: m.fromAddress ?? m.sender ?? "",
    receivedTime: String(m.receivedTime ?? ""),
    summary: m.summary ?? "",
  }));
}

const REMIT_PATTERN =
  /remit|payment|paid|e-?transfer|etransfer|eft|wire|deposit|invoice|cheque|check\b/i;

/**
 * Likely remittance emails from the recent inbox, rendered for prompt
 * injection. Best-effort: any failure returns a plain-text note.
 */
export async function renderRemittanceCandidates(limit = 15): Promise<string> {
  const messages = await fetchRecentMessages(75);
  const candidates = messages
    .filter((m) => REMIT_PATTERN.test(`${m.subject} ${m.summary}`))
    .slice(0, limit);
  if (candidates.length === 0) {
    return "(no likely remittance emails in the recent inbox)";
  }
  return candidates
    .map(
      (m) =>
        `- [${m.receivedTime}] FROM ${m.from} — "${m.subject}" — ${m.summary.slice(0, 160)}`
    )
    .join("\n");
}

export function mailConfigured(): boolean {
  // Mail rides on the same OAuth env as Books; the scope decides access.
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN
  );
}
