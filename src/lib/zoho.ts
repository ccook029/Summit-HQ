// ---------------------------------------------------------------------------
// zoho.ts — shared Zoho OAuth flow for the whole app
//
// One OAuth 2.0 refresh-token flow reused by every Zoho surface (today:
// zoho-books.ts for the Finance department's read-only Books feed). The
// token is cached in three layers to respect Zoho's hard rate limit on the
// refresh endpoint — see the cache notes below.
//
// Required env vars:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID
//
// Optional:
//   ZOHO_DOMAIN       (defaults to https://www.zohoapis.com)
//   ZOHO_ACCOUNTS_URL (defaults to https://accounts.zoho.com)
// ---------------------------------------------------------------------------

// ---- OAuth token cache ----------------------------------------------------
//
// Zoho rate-limits the token-refresh endpoint hard ("you have made too many
// requests"). To avoid tripping it we cache the access token in THREE layers:
//   1. In-memory (fast path within a warm serverless instance).
//   2. A single in-flight promise so concurrent callers (e.g. 4 parallel Books
//      fetches on a cold start) share ONE refresh instead of firing four.
//   3. Vercel KV, so the ~1-hour access token is shared across serverless
//      invocations and we refresh roughly once per hour for the whole app,
//      not once per cold start.
import { kv } from "@vercel/kv";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_CACHE_KEY = "zoho-access-token-cache";

let cachedToken: CachedToken | null = null;
let inflight: Promise<string> | null = null;

export function getEnvOrThrow(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} env var is not set`);
  return val;
}

function isValid(tok: CachedToken | null): tok is CachedToken {
  return !!tok && Date.now() < tok.expiresAt - 60_000; // 60s safety buffer
}

/** Clear the cached access token everywhere (call after a 401/403). */
export async function invalidateTokenCache(): Promise<void> {
  cachedToken = null;
  try {
    await kv.del(TOKEN_CACHE_KEY);
  } catch {
    /* KV optional — ignore */
  }
}

export async function getAccessToken(): Promise<string> {
  if (isValid(cachedToken)) return cachedToken.accessToken;
  // Collapse concurrent callers onto a single refresh.
  if (inflight) return inflight;
  inflight = acquireToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function acquireToken(): Promise<string> {
  // Shared cross-invocation cache (survives serverless cold starts).
  try {
    const kvTok = await kv.get<CachedToken>(TOKEN_CACHE_KEY);
    if (isValid(kvTok)) {
      cachedToken = kvTok;
      return kvTok.accessToken;
    }
  } catch {
    /* KV optional — fall through to a live refresh */
  }

  const clientId = getEnvOrThrow("ZOHO_CLIENT_ID");
  const clientSecret = getEnvOrThrow("ZOHO_CLIENT_SECRET");
  const refreshToken = getEnvOrThrow("ZOHO_REFRESH_TOKEN");
  const accountsUrl =
    process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${accountsUrl}/oauth/v2/token?${params}`, {
    method: "POST",
  });

  if (!res.ok) {
    const body = await res.text();
    cachedToken = null;
    throw new Error(
      `Zoho OAuth token refresh failed (${res.status}): ${body}. ` +
        "The refresh token may be expired or revoked — regenerate it in the Zoho API Console."
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    error?: string;
  };

  if (data.error) {
    cachedToken = null;
    throw new Error(
      `Zoho OAuth error: ${data.error}. ` +
        "The refresh token may be expired or revoked — regenerate it in the Zoho API Console."
    );
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  try {
    await kv.set(TOKEN_CACHE_KEY, cachedToken);
  } catch {
    /* KV optional — in-memory cache still applies */
  }

  return cachedToken.accessToken;
}
