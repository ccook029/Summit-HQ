"use client";

// ---------------------------------------------------------------------------
// /knowledge — the shared company brain. Any staff member can read it; the
// accounting owner edits it. Everything they save here is read by every agent
// (chats, scheduled runs, and the Morning Brief), so a fact is taught once.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import PageHeader from "@/components/page-header";

export default function KnowledgePage() {
  const [content, setContent] = useState("");
  const [meta, setMeta] = useState<{ updatedAt?: string; updatedBy?: string }>({});
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/os/me").then((r) => r.json()).catch(() => ({})),
      fetch("/api/org-knowledge").then((r) => r.json()).catch(() => ({})),
    ]).then(([me, kb]) => {
      // Editable by the accounting owner, or by anyone when auth is off (dev).
      setCanEdit(!me.authEnabled || Boolean(me.isAccountingOwner));
      setContent(kb.knowledge?.content ?? "");
      setMeta({
        updatedAt: kb.knowledge?.updatedAt,
        updatedBy: kb.knowledge?.updatedBy,
      });
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/org-knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.knowledge) {
        setMeta({
          updatedAt: data.knowledge.updatedAt,
          updatedBy: data.knowledge.updatedBy,
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      <PageHeader
        eyebrow="Summit OS"
        title="Company Knowledge"
        subtitle="Facts about how Summit runs — the business brief, the ICP, vendors, policies, voice. Every agent reads this, so you teach the company once instead of each agent separately."
      />

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            readOnly={!canEdit}
            placeholder={
              canEdit
                ? "e.g.\n- Summit sells [what] to [whom] — the ICP is [who buys].\n- We're cash-basis on payables.\n- Recurring vendor X = [what those payments are].\n- Voice: direct, plain, no buzzwords."
                : "(No company knowledge has been added yet.)"
            }
            className="w-full min-h-[420px] rounded-xl border border-line bg-paper p-4 font-mono text-sm text-slate-800 focus:border-sky focus:outline-none disabled:opacity-70"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {meta.updatedAt
                ? `Last updated ${new Date(meta.updatedAt).toLocaleString()}${meta.updatedBy ? ` by ${meta.updatedBy}` : ""}`
                : "Not saved yet"}
            </p>
            {canEdit ? (
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-navy text-white font-semibold px-5 py-2 text-sm hover:bg-navy-deep transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
              </button>
            ) : (
              <span className="text-xs text-slate-400">
                Read-only — ask the accounting owner to edit.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
