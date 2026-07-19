// ---------------------------------------------------------------------------
// middleware.ts — the Summit HQ front door.
//
// Opt-in: enforcement turns on when SUMMIT_OS_SESSION_SECRET is set, so a
// deploy without the env var behaves exactly as before (use Vercel
// Deployment Protection until then).
//
// Everything requires a valid summit_os_session cookie except:
//   - /login and the /api/os/* auth endpoints themselves
//   - machine traffic that carries its own bearer secret (Vercel cron with
//     CRON_SECRET; external signal pushes with MODULES_SHARED_KEY) — those
//     routes keep verifying the bearer themselves
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { OS_COOKIE, osAuthEnabled, verifyOsToken } from "@/lib/os-auth";

const PUBLIC_PREFIXES = ["/login", "/api/os/"];

export async function middleware(request: NextRequest) {
  if (!osAuthEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Machine-to-machine callers authenticate with their own bearer secrets;
  // let the routes do their existing checks.
  const auth = request.headers.get("authorization");
  if (auth) {
    const cron = process.env.CRON_SECRET;
    const modules = process.env.MODULES_SHARED_KEY;
    if (
      (cron && auth === `Bearer ${cron}`) ||
      (modules && auth === `Bearer ${modules}`)
    ) {
      return NextResponse.next();
    }
  }

  const staffId = await verifyOsToken(request.cookies.get(OS_COOKIE)?.value);
  if (staffId !== null) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized — Summit HQ sign-in required." },
      { status: 401 }
    );
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Skip static assets entirely.
  matcher: ["/((?!_next/static|_next/image|images|favicon.ico|icon|apple-icon).*)"],
};
