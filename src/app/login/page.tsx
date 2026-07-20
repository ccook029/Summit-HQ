"use client";

// ---------------------------------------------------------------------------
// /login — the Summit HQ front door.
// A single passcode goes to /api/os/login (OS_SHARED_PASSCODE). The session
// model supports per-person staff logins later; today Summit is single-owner.
// ---------------------------------------------------------------------------
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SummitLogo } from "@/components/logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "sso" ? "Sign-in link expired — log in below." : null
  );
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/os/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Sign-in failed.");
        return;
      }
      const next = params.get("next");
      router.push(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel/95 backdrop-blur p-8">
        <div className="flex flex-col items-center gap-3 mb-8">
          <SummitLogo className="h-24 w-auto" />
          <h1 className="sr-only">Summit Equipment HQ</h1>
          <p className="text-sm text-slate-500 text-center">
            Owner sign-in — your AI staff is inside.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
              Passcode
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-lg bg-paper border border-line px-3 py-2 text-sm focus:border-sky focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-navy text-white font-semibold py-2 text-sm hover:bg-navy-deep transition-colors disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
