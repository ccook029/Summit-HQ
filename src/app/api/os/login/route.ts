// ---------------------------------------------------------------------------
// POST /api/os/login — sign in to Summit HQ.
//
// Summit runs a single-owner login: OS_SHARED_PASSCODE lets the owner in as
// the shared identity (id 0). The token scheme (HMAC, os-auth.ts) supports
// per-person staff ids, so a real staff directory can be added later without
// changing the session model.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  OS_COOKIE,
  SHARED_STAFF_ID,
  mintOsToken,
  osAuthEnabled,
  osCookieOptions,
} from "@/lib/os-auth";

export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
  if (!osAuthEnabled()) {
    return fail(503, "Login is not enabled — set SUMMIT_OS_SESSION_SECRET.");
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return fail(400, "Passcode is required.");

  const passcode = process.env.OS_SHARED_PASSCODE;
  if (!passcode) {
    return fail(503, "Passcode login is not enabled — set OS_SHARED_PASSCODE.");
  }
  if (password !== passcode) return fail(401, "Invalid passcode.");

  const token = await mintOsToken(SHARED_STAFF_ID);
  const out = NextResponse.json({
    ok: true,
    staff: { id: SHARED_STAFF_ID, name: "Summit Owner", email: "" },
  });
  out.cookies.set(OS_COOKIE, token, osCookieOptions);
  return out;
}
