"use client";

// ---------------------------------------------------------------------------
// OwnerNav — the owner's desk links (Review, Questions), shown only to the
// signed-in owner. Renders nothing for everyone else.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Link from "next/link";

export default function OwnerNav() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch("/api/os/me")
      .then((r) => r.json())
      .then((d) => setShow(Boolean(d.isAccountingOwner)))
      .catch(() => {});
  }, []);

  if (!show) return null;

  return (
    <>
      <Link
        href="/review"
        className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        Review
      </Link>
      <Link
        href="/questions"
        className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        Questions
      </Link>
    </>
  );
}
