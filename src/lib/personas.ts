// ---------------------------------------------------------------------------
// Agent Personas — Summit HQ
//
// Each employee has a persona card: name, title, department, avatar, and bio.
// Used across the dashboard, detail pages, and home page. The org STRUCTURE
// (departments, reporting lines) lives in org/directory.ts — this file is
// faces and color, keyed by the same ids.
// ---------------------------------------------------------------------------

export interface AgentPersona {
  agentId: string;
  name: string;
  title: string;
  department: string;
  bio: string;
  status: "active" | "standby";
  schedule: string; // human-readable
  avatarInitials: string;
  avatarColor: string; // tailwind bg class
  avatarAccent: string; // tailwind ring/border class
  runEndpoint: string;
  taskTypes?: string[];
  /** Standalone deployed tool launched in a new tab. */
  external?: boolean;
  launchUrl?: string;
  /** Staffed employees who receive WORK ORDERS through their boss. */
  assignHref?: string;
  /** Tools / workspaces this person works in. */
  tools?: { label: string; href: string; description?: string; external?: boolean }[];
}

// Leadership — the owner (a real human at the top, not an AI agent)
export interface LeaderPersona {
  name: string;
  title: string;
  avatarInitials: string;
  avatarColor: string;
  avatarAccent: string;
}

const leadership: LeaderPersona[] = [
  {
    name: "Chris Cook",
    title: "Partner",
    avatarInitials: "CC",
    avatarColor: "bg-navy",
    avatarAccent: "ring-sky",
  },
  {
    name: "Brad",
    title: "Partner",
    avatarInitials: "B",
    avatarColor: "bg-skydeep",
    avatarAccent: "ring-sky",
  },
];

export function getLeadership(): LeaderPersona[] {
  return leadership;
}

const personas: AgentPersona[] = [
  // ---- Office of the Owner -------------------------------------------------
  {
    agentId: "chief-of-staff",
    name: "Emery Stone",
    title: "Chief of Staff",
    department: "Office of the Owner",
    bio: "Emery reads the whole company so Chris doesn't have to: every department's output, the review queue, the open questions — distilled into one briefing that leads with what actually needs a decision.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "ES",
    avatarColor: "bg-slate-700",
    avatarAccent: "ring-slate-400",
    runEndpoint: "",
    assignHref: "/org#executive",
  },

  // ---- Finance & Accounting ------------------------------------------------
  {
    agentId: "controller",
    name: "Margot Vail",
    title: "Controller",
    department: "Finance & Accounting",
    bio: "Margot has closed books at companies ten times Summit's size and brings that discipline here: every number sourced, every anomaly chased, nothing papered over. Her review is the reason the owner can trust what reaches his queue.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "MV",
    avatarColor: "bg-emerald-800",
    avatarAccent: "ring-emerald-400",
    runEndpoint: "",
    assignHref: "/org#finance",
  },
  {
    agentId: "bookkeeper",
    name: "Otis Fairbank",
    title: "Bookkeeper",
    department: "Finance & Accounting",
    bio: "Otis works the transactions one at a time: categorize, reconcile, flag what doesn't smell right. He'd rather ask one precise question than guess at a posting — and he never invents a number.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "OF",
    avatarColor: "bg-emerald-700",
    avatarAccent: "ring-emerald-300",
    runEndpoint: "",
    assignHref: "/org#finance",
  },
  {
    agentId: "financial-analyst",
    name: "Priya Chandra",
    title: "Financial Analyst",
    department: "Finance & Accounting",
    bio: "Priya turns the ledger into foresight: cash outlook, margins, and where the spend is drifting. She shows the math openly and tags her confidence, so a forecast is never mistaken for a fact.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "PC",
    avatarColor: "bg-teal-700",
    avatarAccent: "ring-teal-300",
    runEndpoint: "",
    assignHref: "/org#finance",
  },

  // ---- Operations ----------------------------------------------------------
  {
    agentId: "ops-manager",
    name: "Rowan Hale",
    title: "Operations Manager",
    department: "Operations",
    bio: "Rowan keeps the operational drumbeat: what's due, what's slipping, who owes us an answer. Nothing leaves the department for a vendor's inbox without clearing Rowan's review first.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "RH",
    avatarColor: "bg-amber-800",
    avatarAccent: "ring-amber-400",
    runEndpoint: "",
    assignHref: "/org#operations",
  },
  {
    agentId: "ops-coordinator",
    name: "Dash Ortega",
    title: "Operations Coordinator",
    department: "Operations",
    bio: "Dash is the follow-up that never slips: vendor emails drafted and ready to send, schedules tracked, commitments chased before they become problems. Direct, warm, and allergic to vague asks.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "DO",
    avatarColor: "bg-amber-700",
    avatarAccent: "ring-amber-300",
    runEndpoint: "",
    assignHref: "/org#operations",
  },

  // ---- Business Development ------------------------------------------------
  {
    agentId: "bd-director",
    name: "Sasha Whitfield",
    title: "BD Director",
    department: "Business Development",
    bio: "Sasha runs the funnel — research, qualify, outreach — and holds the line on honesty: real prospects with cited sources, honest fit calls, and first-touch emails a human would actually answer.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "SW",
    avatarColor: "bg-indigo-800",
    avatarAccent: "ring-indigo-400",
    runEndpoint: "",
    assignHref: "/org#bizdev",
  },
  {
    agentId: "lead-researcher",
    name: "Miles Calloway",
    title: "Lead Researcher",
    department: "Business Development",
    bio: "Miles hunts prospects on the live web with search in hand — real companies, real fit signals, sources cited. If a contact isn't public, he says 'none found' instead of making one up.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "MC",
    avatarColor: "bg-indigo-700",
    avatarAccent: "ring-indigo-300",
    runEndpoint: "",
    assignHref: "/org#bizdev",
  },
  {
    agentId: "lead-qualifier",
    name: "Greta Lindqvist",
    title: "Lead Qualifier",
    department: "Business Development",
    bio: "Greta scores every prospect against the ICP and says the quiet part: a confident COLD saves the team a week. She ranks by fit and readiness, never by size alone.",
    status: "active",
    schedule: "On demand",
    avatarInitials: "GL",
    avatarColor: "bg-violet-700",
    avatarAccent: "ring-violet-300",
    runEndpoint: "",
    assignHref: "/org#bizdev",
  },
  {
    agentId: "outreach-writer",
    name: "Jonah Reyes",
    title: "Outreach Writer",
    department: "Business Development",
    bio: "Jonah writes first-touch emails in the owner's voice: specific, short, one low-pressure ask. The test on every draft — would this exact person reply, or does it read like a template?",
    status: "active",
    schedule: "On demand",
    avatarInitials: "JR",
    avatarColor: "bg-violet-800",
    avatarAccent: "ring-violet-400",
    runEndpoint: "",
    assignHref: "/org#bizdev",
  },
];

export function getAllPersonas(): AgentPersona[] {
  return personas;
}

export function getPersonaByAgentId(agentId: string): AgentPersona | undefined {
  return personas.find((p) => p.agentId === agentId);
}

export default personas;
