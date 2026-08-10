// ---------------------------------------------------------------------------
// GET /api/health/integrations — live health of the deployed integrations,
// using the PRODUCTION env credentials (the exact token the employees use).
// Behind the login wall like everything else.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/zoho";
import { fetchLocations } from "@/lib/zoho-books";
import { fetchRecentMessages } from "@/lib/zoho-mail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Check {
  ok: boolean;
  detail: string;
}

async function check(fn: () => Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await fn() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message.slice(0, 300) : String(err) };
  }
}

export async function GET() {
  const configured = Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN &&
      process.env.ZOHO_ORGANIZATION_ID
  );
  if (!configured) {
    return NextResponse.json({
      configured: false,
      note: "ZOHO_* env vars are not all set on this deployment.",
    });
  }

  const oauth = await check(async () => {
    await getAccessToken();
    return "refresh token exchanges for an access token";
  });

  // If OAuth itself fails, everything downstream will too.
  const books = oauth.ok
    ? await check(async () => {
        const locations = await fetchLocations();
        return locations.length > 0
          ? `locations visible: ${locations.map((l) => l.name).join(", ")}`
          : "connected (no locations configured — org-wide numbers)";
      })
    : { ok: false, detail: "skipped — OAuth failed" };

  const mail = oauth.ok
    ? await check(async () => {
        const msgs = await fetchRecentMessages(5);
        return `inbox reachable — ${msgs.length} recent message${msgs.length === 1 ? "" : "s"} visible`;
      })
    : { ok: false, detail: "skipped — OAuth failed" };

  return NextResponse.json({
    configured: true,
    oauth,
    books,
    mail,
    hint: !mail.ok && /INVALID_OAUTHSCOPE/i.test(mail.detail)
      ? "The refresh token in Vercel does NOT carry the Mail scopes. Generate a token at /setup/zoho whose Mail check is green, then replace ZOHO_REFRESH_TOKEN and redeploy."
      : null,
  });
}
