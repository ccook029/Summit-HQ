// ---------------------------------------------------------------------------
// logo.tsx — the Summit Equipment mark, recreated as SVG from the brand logo.
//
// Two peaks (sky-blue front, navy back, lightning-jag edges) over the curved
// horizon swoosh, with the SUMMIT / EQUIPMENT lockup. Colors are the brand
// constants below; swap in the original PNG at public/brand/logo.png and
// point these components at it if pixel-perfect fidelity is ever needed.
// ---------------------------------------------------------------------------

export const BRAND = {
  navy: "#163e6c",
  sky: "#5fa9f5",
  steel: "#b3b7bc",
};

/** The mountain mark alone (square-ish), for headers and favicons. */
export function SummitMark({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 74"
      className={className}
      aria-hidden
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Back (navy) peak with jag on its right slope */}
      <path
        d="M63 14 L92 52 L86 52 L78 41 L81 55 L96 62 L104 62 L68 14 Z"
        fill={BRAND.navy}
      />
      {/* Front (sky) peak with lightning jag on the left slope */}
      <path
        d="M60 6 L26 52 L33 45 L30 58 L38 58 L60 26 L82 58 L90 58 L60 6 Z"
        fill={BRAND.sky}
      />
      {/* Horizon swoosh */}
      <path
        d="M4 66 C 36 56, 84 56, 116 64 C 86 60, 34 60, 4 66 Z"
        fill={BRAND.sky}
      />
    </svg>
  );
}

/** Full lockup: mark + SUMMIT / EQUIPMENT wordmark. */
export function SummitLogo({
  className = "h-14 w-auto",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 300 118"
      className={className}
      role="img"
      aria-label="Summit Equipment"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(90 0) scale(1)">
        <path
          d="M63 10 L88 43 L83 43 L76 34 L79 46 L91 52 L98 52 L68 10 Z"
          fill={BRAND.navy}
        />
        <path
          d="M60 4 L30 44 L36 38 L34 49 L41 49 L60 21 L79 49 L86 49 L60 4 Z"
          fill={BRAND.sky}
        />
        <path
          d="M12 56 C 44 47, 84 47, 112 54 C 84 51, 42 51, 12 56 Z"
          fill={BRAND.sky}
        />
      </g>
      <text
        x="150"
        y="92"
        textAnchor="middle"
        fill={BRAND.navy}
        fontFamily="'Barlow Condensed','Barlow',sans-serif"
        fontWeight="700"
        fontSize="40"
        letterSpacing="6"
      >
        SUMMIT
      </text>
      <text
        x="150"
        y="112"
        textAnchor="middle"
        fill={BRAND.steel}
        fontFamily="'Barlow',sans-serif"
        fontWeight="600"
        fontSize="14"
        letterSpacing="9"
      >
        EQUIPMENT
      </text>
    </svg>
  );
}
