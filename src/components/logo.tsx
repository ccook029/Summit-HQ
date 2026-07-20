// ---------------------------------------------------------------------------
// logo.tsx — the Summit Equipment logo, hand-traced as SVG from the brand
// artwork: two outlined peaks with lightning-jag slopes (sky-blue front, navy
// back), the curved horizon swoosh, and the squared SUMMIT letterforms with
// the letter-spaced EQUIPMENT line.
//
// If the original PNG/SVG asset is ever added to the repo (public/brand/),
// these components can be swapped for an <img> in one place.
// ---------------------------------------------------------------------------

export const BRAND = {
  navy: "#14406b",
  sky: "#5fa9f5",
  steel: "#b0b4b9",
};

/** The mountain mark alone, for the header and small placements. */
export function SummitMark({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="130 20 980 345"
      className={className}
      aria-hidden
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <Mark />
    </svg>
  );
}

/** Full lockup: mark + SUMMIT / EQUIPMENT wordmark. */
export function SummitLogo({ className = "h-14 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1280 690"
      className={className}
      role="img"
      aria-label="Summit Equipment"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <Mark />
      <Wordmark />
    </svg>
  );
}

/** Peaks + swoosh, in lockup coordinates (1280×690 canvas). */
function Mark() {
  return (
    <g>
      {/* Back (navy) peak — a thick band from its apex down-right, with a
          lightning jag breaking the outer slope. Drawn first; the front peak
          overlaps it with a white separation stroke. */}
      <path
        d="M 668 52
           L 780 162
           L 752 180
           L 818 208
           L 882 272
           L 816 272
           L 668 130
           Z"
        fill={BRAND.navy}
      />

      {/* Front (sky) peak — thick chevron outline with a hollow core and a
          lightning jag on the outer-left slope. White edge separates it from
          the navy peak behind. */}
      <path
        d="M 620 40
           L 540 132
           L 568 156
           L 430 290
           L 506 290
           L 620 152
           L 736 290
           L 810 290
           Z"
        fill={BRAND.sky}
        stroke="#ffffff"
        strokeWidth="10"
        strokeLinejoin="round"
      />

      {/* Horizon swoosh — wide, thin, tapered crescent under the peaks. */}
      <path
        d="M 150 345
           C 420 275 880 268 1080 310
           C 870 295 420 300 150 345
           Z"
        fill={BRAND.sky}
      />
    </g>
  );
}

/** SUMMIT (squared stroke letterforms) + EQUIPMENT (letter-spaced). */
function Wordmark() {
  const s = {
    stroke: BRAND.navy,
    strokeWidth: 34,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none" as const,
  };
  return (
    <g>
      {/* S */}
      <path d="M 212 408 L 110 408 Q 78 408 78 440 L 78 452 Q 78 484 110 484 L 180 484 Q 212 484 212 516 L 212 528 Q 212 560 180 560 L 78 560" {...s} />
      {/* U */}
      <path d="M 268 408 L 268 528 Q 268 560 300 560 L 380 560 Q 412 560 412 528 L 412 408" {...s} />
      {/* M */}
      <path d="M 468 560 L 468 408 L 556 535 L 644 408 L 644 560" {...s} />
      {/* M */}
      <path d="M 700 560 L 700 408 L 788 535 L 876 408 L 876 560" {...s} />
      {/* I */}
      <path d="M 938 408 L 938 560" {...s} />
      {/* T */}
      <path d="M 996 408 L 1200 408 M 1098 408 L 1098 560" {...s} />

      {/* EQUIPMENT */}
      <text
        x="640"
        y="648"
        textAnchor="middle"
        fill={BRAND.steel}
        fontFamily="'Barlow', ui-sans-serif, sans-serif"
        fontWeight="600"
        fontSize="56"
        letterSpacing="44"
      >
        EQUIPMENT
      </text>
    </g>
  );
}
