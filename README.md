# Summit HQ

The corporate headquarters for **Summit Equipment** ([summitel.ca](https://summitel.ca)) —
an internal hub where AI *employees*, grouped into *departments* with *bosses*
who review work before it reaches the owner, run the day-to-day of the
business: buying, selling, and leasing liquid and dry bulk pneumatic tanks.

Built on the "Tilt OS" pattern (see `docs/HQBLUEPRINT.md` for the build
guide this repo follows). One Next.js App Router app on Vercel; state in
Vercel KV; no database required.

## How it works

```
work order → worker drafts → boss reviews (approve / send back / escalate)
          → owner console (/review) → approve & ship
```

- **Escalation answers become standing policy** — a question is asked once.
- **Propose-only** — employees draft; a human applies changes and sends
  emails. Deliverable emails live in fenced ```email blocks, ready to send.
- **Grounded** — each department's context feed (`src/lib/org/department-context.ts`)
  injects live data into both the worker and its reviewer. Finance reads
  Zoho Books (read-only). Every feed is best-effort: a missing integration
  degrades to a note, never an error.

## The org

| Department | Boss | Team |
|---|---|---|
| Office of the Owner | — (reports to Chris) | Emery Stone, Chief of Staff |
| Finance & Accounting | Margot Vail, Controller | Otis Fairbank (Bookkeeper) · Priya Chandra (Financial Analyst) |
| Operations | Rowan Hale, Ops Manager | Dash Ortega (Ops Coordinator) |
| Business Development | Sasha Whitfield, BD Director | Miles Calloway (Lead Researcher, web search) · Greta Lindqvist (Lead Qualifier) · Jonah Reyes (Outreach Writer) |

Hiring more positions later = adding entries to `src/lib/org/directory.ts` +
a prompt profile in `src/lib/org/employee-configs.ts`.

## Surfaces

| Route | What it is |
|---|---|
| `/` | Home — org chart, status card, leadership |
| `/org` | Org chart + assign work |
| `/org/[id]` | Employee page: chat, voice picker, work history, dispatch |
| `/review` | The owner console — approve & ship, send back, answer escalations |
| `/questions` | Open escalations across every department |
| `/dashboard` | Operations overview — failures, signals, activity |
| `/knowledge` | Editable company knowledge (teach the company once) |

## Setup

See `docs/SETUP.md` — env vars, Zoho wiring, and the owner questions that
still need answering (`docs/ETHOS.md` §1–2, the ICP, the ops definition).

```bash
npm install
npm run lint   # tsc --noEmit
npm run dev
```

Deploy on Vercel with a KV store attached — **`main` is the production
branch** (set it in Vercel → Settings → Git). `vercel.json` restricts builds
to `main` and the setup branch on purpose.
