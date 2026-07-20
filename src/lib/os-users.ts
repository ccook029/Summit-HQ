// ---------------------------------------------------------------------------
// os-users.ts — the user directory for Summit HQ's login, defined in env.
//
// A two-person company doesn't need a signup flow or a password database:
// the accounts live in ONE Vercel env var and can be rotated there anytime.
//
//   OS_USERS="Chris Cook|chris@example.com|password1; Brad Smith|brad@example.com|password2"
//
// Format: entries separated by ";", fields by "|" → name | email | password.
// Staff ids are positional (first entry = 1, second = 2, …), which is what
// the session token carries — so keep the order stable when editing.
// ---------------------------------------------------------------------------

export interface OsUser {
  id: number;
  name: string;
  email: string;
  password: string;
}

export function getConfiguredUsers(): OsUser[] {
  const raw = process.env.OS_USERS;
  if (!raw?.trim()) return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const [name, email, password] = entry.split("|").map((f) => f.trim());
      return {
        id: i + 1,
        name: name ?? "",
        email: (email ?? "").toLowerCase(),
        password: password ?? "",
      };
    })
    .filter((u) => u.name && u.email && u.password);
}

export function usersConfigured(): boolean {
  return getConfiguredUsers().length > 0;
}

function safeEqual(a: string, b: string): boolean {
  // Length-leak is acceptable here; constant-time over the shared length.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify an email + password against the configured users. */
export function verifyUser(email: string, password: string): OsUser | null {
  const target = email.trim().toLowerCase();
  for (const u of getConfiguredUsers()) {
    if (u.email === target && safeEqual(u.password, password)) return u;
  }
  return null;
}
