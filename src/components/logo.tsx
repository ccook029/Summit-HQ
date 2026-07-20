// ---------------------------------------------------------------------------
// logo.tsx — the actual Summit Equipment logo.
//
// Source artwork: public/brand/Summit-Equipment-Logo.jpg (uploaded by the
// owner). Derived at build time into:
//   public/brand/logo.png — full lockup, white background made transparent
//   public/brand/mark.png — peaks + swoosh only, for small placements
//   src/app/icon.png      — favicon (mark, squared)
// Same component names/API as before, so every placement stays unchanged.
// ---------------------------------------------------------------------------
/* eslint-disable @next/next/no-img-element */

export const BRAND = {
  navy: "#14406b",
  sky: "#5fa9f5",
  steel: "#b0b4b9",
};

/** The mountain mark alone, for the header and small placements. */
export function SummitMark({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <img
      src="/brand/mark.png"
      alt=""
      aria-hidden
      className={className}
      draggable={false}
    />
  );
}

/** Full lockup: mark + SUMMIT / EQUIPMENT wordmark. */
export function SummitLogo({ className = "h-14 w-auto" }: { className?: string }) {
  return (
    <img
      src="/brand/logo.png"
      alt="Summit Equipment"
      className={className}
      draggable={false}
    />
  );
}
