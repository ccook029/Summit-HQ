// ---------------------------------------------------------------------------
// POST /api/zoho/exchange — one-time Zoho Self Client → refresh token helper.
//
// The owner pastes Client ID, Client Secret, and the short-lived grant code
// from the Zoho API Console into /setup/zoho; this exchanges the code for a
// refresh token and lists the Books organizations so the right
// ZOHO_ORGANIZATION_ID can be copied too. NOTHING is stored — the values are
// returned to the page for the owner to paste into Vercel env vars.
//
// Sits behind the login wall (middleware), like every other route.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATA_CENTERS: Record<string, { accounts: string; api: string }> = {
  com: { accounts: "https://accounts.zoho.com", api: "https://www.zohoapis.com" },
  ca: { accounts: "https://accounts.zohocloud.ca", api: "https://www.zohoapis.ca" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://www.zohoapis.eu" },
  in: { accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in" },
  au: { accounts: "https://accounts.zoho.com.au", api: "https://www.zohoapis.com.au" },
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    clientId?: string;
    clientSecret?: string;
    code?: string;
    dc?: string;
  };
  const clientId = body.clientId?.trim();
  const clientSecret = body.clientSecret?.trim();
  const code = body.code?.trim();
  const dc = DATA_CENTERS[body.dc ?? "com"] ?? DATA_CENTERS.com;

  if (!clientId || !clientSecret || !code) {
    return NextResponse.json(
      { ok: false, error: "Client ID, Client Secret, and the generated code are all required." },
      { status: 400 }
    );
  }

  // 1) Exchange the grant code for tokens.
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
  });
  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${dc.accounts}/oauth/v2/token?${params}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: `Could not reach ${dc.accounts} — try a different data center.` },
      { status: 502 }
    );
  }
  const tok = (await tokenRes.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
  };
  if (!tokenRes.ok || tok.error || !tok.refresh_token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          tok.error === "invalid_code"
            ? "That code expired or was already used — generate a fresh one in the Zoho console (they only last a few minutes) and try again immediately."
            : `Zoho rejected the exchange: ${tok.error ?? tokenRes.status}. If your Zoho account is on a different data center, pick it above and generate a new code.`,
      },
      { status: 400 }
    );
  }

  // 2) List Books organizations so the owner can copy the right org id.
  let orgs: { id: string; name: string }[] = [];
  let orgError: string | null = null;
  try {
    const orgRes = await fetch(`${dc.api}/books/v3/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${tok.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await orgRes.json().catch(() => ({}))) as {
      organizations?: { organization_id: string; name: string }[];
      message?: string;
    };
    if (orgRes.ok && data.organizations) {
      orgs = data.organizations.map((o) => ({ id: o.organization_id, name: o.name }));
    } else {
      orgError = data.message ?? `Books API returned ${orgRes.status}`;
    }
  } catch {
    orgError = "Could not reach the Books API to list organizations.";
  }

  return NextResponse.json({
    ok: true,
    refreshToken: tok.refresh_token,
    organizations: orgs,
    orgError,
    accountsUrl: dc.accounts,
    apiDomain: dc.api,
    isDefaultDc: dc === DATA_CENTERS.com,
  });
}
