import Link from "next/link";
import { getLeadership, getPersonaByAgentId } from "@/lib/personas";
import { getDepartments, getEmployeesByDepartment } from "@/lib/org/directory";
import type { Employee } from "@/lib/org/types";
import HqMetrics from "@/components/hq-metrics";
import CompanyTree, {
  type DepartmentView,
  type MemberView,
} from "@/components/team-grid";
import ScrollReveal from "@/components/scroll-reveal";
import { Stagger, StaggerItem } from "@/components/motion-primitives";
import { SummitLogo } from "@/components/logo";

// Build the org-chart view: directory (structure) + personas (faces/bios).
function toMemberView(e: Employee, isBoss: boolean): MemberView {
  const persona = getPersonaByAgentId(e.personaId ?? e.id);
  return {
    id: e.id,
    name: e.name,
    title: e.title,
    initials:
      persona?.avatarInitials ??
      e.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2),
    color: persona?.avatarColor ?? "bg-slate-200",
    accent: persona?.avatarAccent ?? "ring-slate-300",
    bio: persona?.bio ?? e.charter,
    href: `/org/${e.id}`,
    isBoss,
  };
}

function buildDepartmentViews(): DepartmentView[] {
  return getDepartments().map((d) => {
    const members = getEmployeesByDepartment(d.id).filter((e) => e.enabled);
    const boss = members.find((e) => e.id === d.managerId) ?? null;
    return {
      id: d.id,
      name: d.name,
      mission: d.mission,
      boss: boss ? toMemberView(boss, true) : null,
      members: members
        .filter((e) => e.id !== d.managerId)
        .map((e) => toMemberView(e, false)),
      tools: d.tools ?? [],
    };
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="h-6 w-1 rounded-full bg-navy" />
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-slate-800">
        {children}
      </h2>
    </div>
  );
}

export default function Home() {
  const departments = buildDepartmentViews();
  const leadership = getLeadership();

  return (
    <div className="space-y-16 relative">
      {/* Hero */}
      <div className="pt-6 pb-2 text-center">
        <SummitLogo className="h-32 sm:h-40 w-auto mx-auto" />
        <h1 className="sr-only">Summit Equipment HQ</h1>
        <p className="mt-6 text-slate-500 max-w-2xl mx-auto">
          Your company, staffed. AI employees draft the work, their bosses
          review it, and nothing ships without your approval.
        </p>
      </div>

      {/* Key Metrics */}
      <ScrollReveal>
        <HqMetrics />
      </ScrollReveal>

      {/* Leadership — the Owner */}
      <ScrollReveal>
        <SectionLabel>Leadership</SectionLabel>
        <Stagger className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-2">
          {leadership.map((leader) => (
            <StaggerItem key={leader.name}>
              <div className="group rounded-xl border border-sky/30 hover:border-sky/50 p-6 bg-panel relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-sky/70 to-transparent" />
                <div className="flex items-center gap-5">
                  <div
                    className={`w-16 h-16 rounded-full ${leader.avatarColor} ring-2 ${leader.avatarAccent} flex items-center justify-center text-xl font-bold text-white shadow-lg`}
                  >
                    {leader.avatarInitials}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      {leader.name}
                    </h3>
                    <p className="text-sm text-skydeep">{leader.title}</p>
                  </div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        {/* Connector line from leadership to team */}
        <div className="flex justify-center py-3">
          <div className="w-px h-8 bg-gradient-to-b from-sky/50 to-line" />
        </div>
      </ScrollReveal>

      {/* The Company — departments, reporting lines, and tools */}
      <ScrollReveal>
        <div id="team" className="scroll-mt-24">
          <SectionLabel>The Company</SectionLabel>
          <CompanyTree departments={departments} />
        </div>
      </ScrollReveal>

      {/* Quick Links */}
      <ScrollReveal>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/review"
            className="lift block rounded-lg border border-line p-5 hover:border-sky/50 bg-panel/80"
          >
            <h3 className="font-semibold mb-1">Review Queue</h3>
            <p className="text-sm text-slate-500">
              Work waiting on you — approve &amp; ship, answer escalations,
              retry anything that hit a problem.
            </p>
          </Link>
          <Link
            href="/knowledge"
            className="lift block rounded-lg border border-line p-5 hover:border-sky/50 bg-panel/80"
          >
            <h3 className="font-semibold mb-1">Company Knowledge</h3>
            <p className="text-sm text-slate-500">
              Teach the company once — the business brief, the ICP, policies —
              and every employee applies it from the next task on.
            </p>
          </Link>
        </div>
      </ScrollReveal>
    </div>
  );
}
