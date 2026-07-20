// ---------------------------------------------------------------------------
// POST /api/os/login — sign in to Summit HQ.
//
// Primary path: per-person email + password against the OS_USERS env
// directory (see lib/os-users.ts) — each person gets their own staff id, so
// actions and question assignments are attributable.
//
// Fallback (only when OS_USERS is not configured): the OS_SHARED_PASSCODE
// single-owner bootstrap from the first deploy.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  OS_COOKIE,
  SHARED_STAFF_ID,
  mintOsToken,
  osAuthEnabled,
  osCookieOptions,
} from "@/lib/os-auth";
import { usersConfigured, verifyUser } from "@/lib/os-users";
import { recordStaff } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
  if (!osAuthEnabled()) {
    return fail(503, "Login is not enabled — set SUMMIT_OS_SESSION_SECRET.");
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return fail(400, "Password is required.");

  if (usersConfigured()) {
    if (!email) return fail(400, "Email is required.");
    const user = verifyUser(email, password);
    if (!user) return fail(401, "Invalid email or password.");

    // Remember this person so their name shows on questions and reviews.
    await recordStaff({ id: user.id, name: user.name, email: user.email });

    const token = await mintOsToken(user.id);
    const out = NextResponse.json({
      ok: true,
      staff: { id: user.id, name: user.name, email: user.email },
    });
    out.cookies.set(OS_COOKIE, token, osCookieOptions);
    return out;
  }

  // Fallback: shared passcode (pre-OS_USERS bootstrap).
  const passcode = process.env.OS_SHARED_PASSCODE;
  if (!passcode) {
    return fail(503, "No login method configured — set OS_USERS (or OS_SHARED_PASSCODE).");
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
