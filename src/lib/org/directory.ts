// ---------------------------------------------------------------------------
// org/directory.ts — The Summit org chart as data
//
// Departments, employees, and reporting lines the engine actually enforces.
// The owner (Chris Cook) sits above every reportsTo: null position.
//
// Every department has a wired boss so it can plan-and-dispatch through the
// engine (worker → boss review → Chris's queue):
//   finance     Margot (Controller) → Otis (Bookkeeper), Priya (Analyst)
//   operations  Rowan (Ops Manager) → Dash (Ops Coordinator)
//   bizdev      Sasha (BD Director) → Miles (Research), Greta (Qualify),
//               Jonah (Outreach)
//   executive   Emery (Chief of Staff) — reports straight to Chris
//
// Each staffed position has a prompt profile in employee-configs.ts; bosses
// also carry a managerSystemPrompt there. To add a hire later: add the
// directory entry (staffed: false reserves a seat), then write its profile.
// ---------------------------------------------------------------------------
import type { Department, Employee } from "./types";

const departments: Department[] = [
  {
    id: "executive",
    name: "Office of the Owner",
    mission:
      "Keep the owner ahead of the whole company without drowning him: synthesize every department into one clear briefing — what shipped, what needs a decision, what's stuck — so Chris spends his scarce hours on the calls only he can make.",
    managerId: null,
    tools: [
      {
        label: "Review Queue",
        href: "/review",
        description: "Everything waiting on the owner",
      },
      {
        label: "Operations Overview",
        href: "/dashboard",
        description: "Company-wide activity stream and attention items",
      },
    ],
  },
  {
    id: "finance",
    name: "Finance & Accounting",
    mission:
      "Keep Summit's books clean, current, and decision-grade: bookkeeping in Zoho Books, categorization and reconciliation, anomaly-spotting, cash outlook, and spend review for the owner.",
    managerId: "controller",
    tools: [
      {
        label: "Decisions Queue",
        href: "/questions",
        description: "Open finance questions awaiting your call",
      },
      {
        label: "Company Knowledge",
        href: "/knowledge",
        description: "Standing facts and policies the books follow",
      },
    ],
  },
  {
    id: "operations",
    name: "Operations",
    mission:
      "Keep the day-to-day machinery of Summit running: vendor and supplier communications, schedules and follow-ups, and the recurring logistics of the business — tracked, chased, and never dropped.",
    managerId: "ops-manager",
    tools: [
      {
        label: "Operations Overview",
        href: "/dashboard",
        description: "Activity, failures, and attention items",
      },
    ],
  },
  {
    id: "bizdev",
    name: "Business Development",
    mission:
      "Grow Summit's customer base with real prospects, honestly qualified: research genuine leads on the live web, score them against the ideal-customer profile, and draft warm first-touch outreach in the owner's voice. Every lead and every email clears the Director's review, and nothing goes out without the owner's approval.",
    managerId: "bd-director",
    tools: [
      {
        label: "Review Queue",
        href: "/review",
        description: "Leads and outreach awaiting the owner",
      },
      {
        label: "Company Knowledge",
        href: "/knowledge",
        description: "The ICP and outreach rules live here",
      },
    ],
  },
];

const employees: Employee[] = [
  // ---- Office of the Owner -------------------------------------------------
  {
    id: "chief-of-staff",
    name: "Emery Stone",
    title: "Chief of Staff",
    departmentId: "executive",
    role: "worker",
    reportsTo: null,
    skills: ["owner-briefing", "prioritization", "cross-department-synthesis"],
    charter:
      "Reads the whole company — every department's recent output, the owner's review queue, open questions — and turns it into one short briefing: what shipped, what needs Chris's decision (ranked), what's stuck, and the few things that matter most this week. Reports straight to the owner. Most useful once the other departments have activity to summarize.",
    staffed: true,
    enabled: true,
  },

  // ---- Finance & Accounting ------------------------------------------------
  {
    id: "controller",
    name: "Margot Vail",
    title: "Controller",
    departmentId: "finance",
    role: "manager",
    reportsTo: null,
    skills: ["review", "financial-oversight", "policy", "close-discipline"],
    charter:
      "Runs the finance function: reviews the Bookkeeper's and Analyst's work against the live Zoho Books data, resolves what policy and accounting judgment cover, and escalates only genuinely owner-level calls to Chris.",
    staffed: true,
    enabled: true,
  },
  {
    id: "bookkeeper",
    name: "Otis Fairbank",
    title: "Bookkeeper",
    departmentId: "finance",
    role: "worker",
    reportsTo: "controller",
    skills: ["categorization", "reconciliation", "anomaly-flagging", "monthly-close"],
    charter:
      "Hands-on bookkeeping against Zoho Books: categorizing transactions, reconciling accounts, hunting duplicates and anomalies. Propose-only — he drafts the categorization or correction; a human applies it. Anything he can't decide goes to Margot, never straight to Chris.",
    staffed: true,
    enabled: true,
  },
  {
    id: "financial-analyst",
    name: "Priya Chandra",
    title: "Financial Analyst",
    departmentId: "finance",
    role: "worker",
    reportsTo: "controller",
    skills: ["cash-outlook", "margin-analysis", "spend-review", "budget-variance"],
    charter:
      "Turns the books into forward-looking numbers: cash outlook and runway, margins, spend review, and budget-vs-actual. Grounds every figure in the Zoho Books feed; Margot reviews before it reaches the owner. Propose-only.",
    staffed: true,
    enabled: true,
  },

  // ---- Operations ----------------------------------------------------------
  {
    id: "ops-manager",
    name: "Rowan Hale",
    title: "Operations Manager",
    departmentId: "operations",
    role: "manager",
    reportsTo: null,
    skills: ["review", "vendor-relations", "scheduling", "process"],
    charter:
      "Owns the operational cadence. Dispatches recurring and one-off ops work to the Coordinator, reviews every deliverable — especially anything a vendor or partner will read — before it reaches Chris, and escalates only true judgment calls.",
    staffed: true,
    enabled: true,
  },
  {
    id: "ops-coordinator",
    name: "Dash Ortega",
    title: "Operations Coordinator",
    departmentId: "operations",
    role: "worker",
    reportsTo: "ops-manager",
    skills: ["vendor-email", "schedule-tracking", "follow-up", "status-digest"],
    charter:
      "Handles the recurring reality of the business: drafts vendor and supplier communications (as ready-to-send ```email blocks), tracks schedules and commitments, chases follow-ups before they slip, and produces status digests. Works from the brief and company knowledge; never invents a vendor, a date, or a commitment.",
    staffed: true,
    enabled: true,
  },

  // ---- Business Development ------------------------------------------------
  {
    id: "bd-director",
    name: "Sasha Whitfield",
    title: "BD Director",
    departmentId: "bizdev",
    role: "manager",
    reportsTo: null,
    skills: ["review", "lead-qualification", "pipeline"],
    charter:
      "Owns outbound growth. Reviews every lead list, every qualification call, and every outreach draft before it reaches the owner — checking prospects are real and cited, reads are honest, and first-touch outreach sounds like Chris and asks for a conversation, not a close. Escalates only real judgment calls.",
    staffed: true,
    enabled: true,
  },
  {
    id: "lead-researcher",
    name: "Miles Calloway",
    title: "Lead Researcher",
    departmentId: "bizdev",
    role: "worker",
    reportsTo: "bd-director",
    skills: ["lead-research", "market-scan", "prospect-list"],
    charter:
      "Finds real prospects on the live web using web search, and gathers the facts that matter: who they are, where they are, size and fit signals, and a public contact where one genuinely exists. Cites sources; never invents a company, a person, or an email.",
    staffed: true,
    enabled: true,
  },
  {
    id: "lead-qualifier",
    name: "Greta Lindqvist",
    title: "Lead Qualifier",
    departmentId: "bizdev",
    role: "worker",
    reportsTo: "bd-director",
    skills: ["lead-qualification", "icp-scoring", "fit-assessment"],
    charter:
      "Scores each researched prospect against Summit's ideal-customer profile (kept in company knowledge) and rates HOT / WARM / COLD with honest reasoning. A confident COLD saves the team time; a padded pipeline wastes it.",
    staffed: true,
    enabled: true,
  },
  {
    id: "outreach-writer",
    name: "Jonah Reyes",
    title: "Outreach Writer",
    departmentId: "bizdev",
    role: "worker",
    reportsTo: "bd-director",
    skills: ["cold-email", "first-touch", "outreach-sequence"],
    charter:
      "Drafts warm, specific first-touch emails to qualified prospects in the owner's voice — relational, low-pressure, aimed at starting a conversation. Deliverables are ready-to-send ```email blocks; a human sends the final word.",
    staffed: true,
    enabled: true,
  },
];

// ---- Lookups ----------------------------------------------------------------

export function getDepartments(): Department[] {
  return departments;
}

export function getDepartmentById(id: string): Department | undefined {
  return departments.find((d) => d.id === id);
}

export function getEmployees(): Employee[] {
  return employees;
}

export function getEmployeeById(id: string): Employee | undefined {
  return employees.find((e) => e.id === id);
}

export function getEmployeesByDepartment(departmentId: string): Employee[] {
  return employees.filter((e) => e.departmentId === departmentId);
}

/** The employee who reviews this employee's work, or undefined when the
 * position reports straight to the owner. */
export function getManagerOf(employee: Employee): Employee | undefined {
  return employee.reportsTo ? getEmployeeById(employee.reportsTo) : undefined;
}

/** Direct reports of a manager. */
export function getDirectReports(managerId: string): Employee[] {
  return employees.filter((e) => e.reportsTo === managerId);
}
