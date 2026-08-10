"use client";

// ---------------------------------------------------------------------------
// /setup/zoho — one-time wizard that turns a Zoho Self Client into the four
// env vars the Finance feed needs. The exchange happens server-side
// (/api/zoho/exchange); nothing is stored — the owner copies the results
// into Vercel and deletes nothing sensitive from here because nothing stays.
// ---------------------------------------------------------------------------
import { useState } from "react";

interface ExchangeResult {
  refreshToken: string;
  organizations: { id: string; name: string }[];
  orgError: string | null;
  mailOk?: boolean;
  mailError?: string | null;
  accountsUrl: string;
  apiDomain: string;
  isDefaultDc: boolean;
}

const SCOPE =
  "ZohoBooks.fullaccess.READ,ZohoBooks.customerpayments.CREATE,ZohoMail.accounts.READ,ZohoMail.messages.READ";

export default function ZohoSetupPage() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [code, setCode] = useState("");
  const [dc, setDc] = useState("com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExchangeResult | null>(null);

  const exchange = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/zoho/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, code, dc }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Exchange failed.");
        return;
      }
      setResult(data as ExchangeResult);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const envBlock = (r: ExchangeResult, orgId: string) =>
    [
      `ZOHO_CLIENT_ID=${clientId.trim()}`,
      `ZOHO_CLIENT_SECRET=${clientSecret.trim()}`,
      `ZOHO_REFRESH_TOKEN=${r.refreshToken}`,
      `ZOHO_ORGANIZATION_ID=${orgId}`,
      ...(r.isDefaultDc
        ? []
        : [`ZOHO_ACCOUNTS_URL=${r.accountsUrl}`, `ZOHO_DOMAIN=${r.apiDomain}`]),
    ].join("\n");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
          Connect <span className="text-skydeep">Zoho Books</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Do the three Zoho steps, paste the results here, and this page hands
          you the exact values for Vercel. Re-run anytime the scope changes —
          the new refresh token just replaces the old env value.
        </p>
      </div>

      <ol className="space-y-3 rounded-xl border border-line bg-panel p-5 text-sm text-slate-600 list-decimal list-inside">
        <li>
          Open{" "}
          <a href="https://api-console.zoho.com" target="_blank" rel="noreferrer" className="text-skydeep underline">
            api-console.zoho.com
          </a>{" "}
          → <b>Add Client</b> → <b>Self Client</b> → Create. Copy the{" "}
          <b>Client ID</b> and <b>Client Secret</b> below.
        </li>
        <li>
          On the <b>Generate Code</b> tab, paste this scope, set duration to
          10 minutes, and click Create:
          <code className="mt-1 block rounded bg-slate-50 border border-line px-2 py-1 text-xs select-all">{SCOPE}</code>
        </li>
        <li>Copy the generated code below and hit Exchange — codes die in minutes, so do this right away.</li>
      </ol>

      <div className="space-y-3 rounded-xl border border-line bg-panel p-5">
        <label className="block text-xs uppercase tracking-wider text-slate-500">
          Client ID
          <input value={clientId} onChange={(e) => setClientId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm normal-case focus:border-sky focus:outline-none" />
        </label>
        <label className="block text-xs uppercase tracking-wider text-slate-500">
          Client Secret
          <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm normal-case focus:border-sky focus:outline-none" />
        </label>
        <label className="block text-xs uppercase tracking-wider text-slate-500">
          Generated code
          <input value={code} onChange={(e) => setCode(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm normal-case focus:border-sky focus:outline-none" />
        </label>
        <label className="block text-xs uppercase tracking-wider text-slate-500">
          Zoho data center
          <select value={dc} onChange={(e) => setDc(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm normal-case focus:border-sky focus:outline-none">
            <option value="com">zoho.com (default)</option>
            <option value="ca">zohocloud.ca (Canada)</option>
            <option value="eu">zoho.eu</option>
            <option value="in">zoho.in</option>
            <option value="au">zoho.com.au</option>
          </select>
        </label>

        {error && (
          <p className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button onClick={exchange} disabled={busy || !clientId || !clientSecret || !code}
          className="w-full rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-deep disabled:opacity-50">
          {busy ? "Exchanging…" : "Exchange for refresh token"}
        </button>
      </div>

      {result && (
        <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-semibold text-emerald-700">
            Token created. Live checks with this exact token:
          </p>
          <ul className="text-sm space-y-1">
            <li className={result.orgError ? "text-amber-700" : "text-emerald-700"}>
              {result.orgError ? `⚠️ Books: ${result.orgError}` : "✅ Books: connected"}
            </li>
            <li className={result.mailOk ? "text-emerald-700" : "text-red-600"}>
              {result.mailOk
                ? "✅ Mail: connected — remittance reading will work"
                : `❌ Mail: NOT working — ${result.mailError ?? "unknown"} Do NOT copy this token to Vercel; regenerate the code with the full scope and exchange again.`}
            </li>
          </ul>
          <p className="text-sm font-semibold text-emerald-700">
            When the checks are green, copy these into Vercel → Settings →
            Environment Variables (one variable per line), then redeploy:
          </p>
          {result.organizations.length > 0 ? (
            result.organizations.map((o) => (
              <div key={o.id}>
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                  For organization: <b>{o.name}</b>
                </p>
                <pre className="overflow-x-auto rounded-lg border border-line bg-white p-3 text-xs select-all">
                  {envBlock(result, o.id)}
                </pre>
              </div>
            ))
          ) : (
            <div>
              <p className="text-sm text-amber-700 mb-1">
                Couldn&apos;t list organizations ({result.orgError}) — copy the
                Organization ID from Zoho Books → Settings and use it as
                ZOHO_ORGANIZATION_ID:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-line bg-white p-3 text-xs select-all">
                {envBlock(result, "YOUR_ORGANIZATION_ID")}
              </pre>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Nothing from this page is saved anywhere — once the values are in
            Vercel, you&apos;re done with it.
          </p>
        </div>
      )}
    </div>
  );
}
