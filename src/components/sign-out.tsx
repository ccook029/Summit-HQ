"use client";

// Sign out of the Summit OS session (no-op redirect to /login when signed out).
import { useRouter } from "next/navigation";

export default function SignOut() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/os/logout", { method: "POST" }).catch(() => {});
        router.push("/login");
        router.refresh();
      }}
      className="text-sm text-gray-600 hover:text-gray-300 transition-colors"
    >
      Sign out
    </button>
  );
}
