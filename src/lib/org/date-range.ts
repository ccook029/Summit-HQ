// ---------------------------------------------------------------------------
// org/date-range.ts — work out what period a pasted/attached statement covers.
//
// Kept dependency-free so it can be reasoned about (and tested) on its own:
// getting this wrong means fetching the wrong window from Books and calling
// already-recorded transactions "missing".
// ---------------------------------------------------------------------------

/**
 * The date window a statement covers, sniffed from its own rows. Handles
 * YYYY-MM-DD and North-American M/D/YYYY, which is what a Canadian bank export
 * actually contains. Returns null when there aren't enough real dates to trust.
 */
export function sniffDateRange(text: string): { from: string; to: string } | null {
  const found: string[] = [];

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    found.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) {
    const [month, day] = [Number(m[1]), Number(m[2])];
    // Ambiguous D/M vs M/D: only accept when the first field can't be a month.
    if (month > 12 || day > 12) {
      const [mm, dd] = month > 12 ? [day, month] : [month, day];
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        found.push(`${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
      }
    } else {
      found.push(`${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }

  const valid = found.filter((d) => {
    const t = new Date(`${d}T00:00:00Z`).getTime();
    return !Number.isNaN(t) && d >= "2015-01-01";
  });
  if (valid.length < 2) return null;

  valid.sort();
  // Pad by a day each side so a posting-lag row at either edge still lines up.
  const shift = (iso: string, days: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(valid[0], -3), to: shift(valid[valid.length - 1], 3) };
}
