# Summit HQ — Setup

## 1. Environment variables

| Var | Needed | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | powers every employee |
| `CLAUDE_MODEL` | recommended | worker model; defaults to `claude-sonnet-5` |
| `CLAUDE_MANAGER_MODEL` | recommended | boss/review model; defaults to `claude-opus-4-8` |
| `KV_*` (Vercel KV / Upstash) | **yes** | auto-added when you attach KV storage to the Vercel project. Give Summit its **own** KV database — don't share Tilt's. |
| `SUMMIT_OS_SESSION_SECRET` | recommended | any long random string; turns on the login wall |
| `OS_SHARED_PASSCODE` | recommended | the passcode you type at `/login` |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` / `ZOHO_ORGANIZATION_ID` | for Finance | read-only Zoho Books feed (see §3) |
| `ZOHO_DOMAIN` / `ZOHO_ACCOUNTS_URL` | optional | default to zohoapis.com / accounts.zoho.com — set to your Zoho data center if different (e.g. `.zoho.eu`) |
| `ZOHO_BOOKS_MCP_URL` / `ZOHO_BOOKS_MCP_TOKEN` | optional | official Zoho Books MCP server; preferred over REST when set |
| `GEMINI_API_KEY` | optional | TTS fallback |
| `ELEVENLABS_API_KEY` | optional | best voices. Must be unrestricted or have **Voices: Read** — a TTS-only scoped key 401s on the voice list |
| `ELEVENLABS_MODEL` | optional | default `eleven_turbo_v2_5` |
| `CRON_SECRET` | later | only when scheduled runs are added |
| `MODULES_SHARED_KEY` | later | only if external tools push signals into `/api/signals` |

Env-var changes only take effect on the **next** deployment. "Redeploy" on an
old row rebuilds the old commit — use Create Deployment → `main`.

## 2. Deploy

1. Vercel → New Project → import this repo. Attach a **new** KV store.
2. Set the env vars above.
3. `vercel.json` already restricts builds to `main` (kills preview noise).

## 3. Zoho Books (Finance's live feed)

The Finance department grounds every draft and review in a read-only Zoho
Books snapshot (`src/lib/zoho-books.ts` → `department-context.ts`). Until the
creds are set, Finance degrades gracefully: employees say the feed isn't wired
and work from whatever you paste into the brief.

To wire it:

1. [Zoho API Console](https://api-console.zoho.com/) → Self Client → generate
   a **refresh token** with scope `ZohoBooks.fullaccess.READ`
   (read-only on purpose — the hub proposes, humans post).
2. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`,
   `ZOHO_ORGANIZATION_ID` (Books → Settings → Organization ID).
3. Optional, preferred when available: the official **Zoho Books MCP server**
   (`ZOHO_BOOKS_MCP_URL` + token). Tool access is controlled in the Zoho
   admin, so propose-only is enforced at the source.

## 4. Owner questions still open (blueprint §0)

The infrastructure is complete, but three business facts are placeholders
until Chris fills them in:

1. **What Summit is** — one paragraph (what it sells, to whom, how it makes
   money) + 5–10 belief bullets → `docs/ETHOS.md` §1–2, mirrored into
   `src/lib/ethos.ts`. This is the highest-leverage edit in the repo.
2. **The ideal-customer profile** — what a *lead* is and what makes one
   *qualified* → add to the `/knowledge` screen (Company Knowledge). BD is
   prompted to escalate rather than guess until this exists.
3. **The operations definition** — what recurring logistical reality Summit
   has (suppliers? bookings? shipments?) → add to `/knowledge`; if physical
   goods move, the Tilt shipment register can be ported later as a live ops
   feed.

## 5. First test drives (in order)

1. **Finance, no integration:** `/org` → assign the Bookkeeper a pasted bank
   feed snippet → categorized draft lands in `/review` after Margot's review.
2. **BD, web search:** assign the Lead Researcher a real prospect-hunting
   brief (include the ICP in the brief until `/knowledge` has it) → confirm
   citations come back.
3. **Dispatch:** on a boss's page, "Dispatch team" → plan + orders fan out.
4. **Zoho:** set the env vars, redeploy, ask the Financial Analyst for a cash
   outlook — the Books snapshot should appear in her grounding.
5. **Chief of Staff last**, once there's activity to summarize.
