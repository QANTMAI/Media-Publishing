/* Pure calendar-date helpers for the custom DatePicker. Kept React-free so the
 * date math is unit-testable on its own. `m` is 0-indexed (JS Date convention);
 * the ISO string is 1-indexed. Parsing is done by hand rather than `new Date`
 * so "YYYY-MM-DD" reads as a local calendar date, never shifted by UTC. */

export function parseISO(v: string | undefined): { y: number; m: number; d: number } | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m: m - 1, d };
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Days in a given 0-indexed month, leap-year aware. */
export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** "HH:MM" (24h) -> "H:MM AM/PM" (12h). Returns "" for malformed input. */
export function format12h(hhmm: string | undefined): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return "";
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Every "HH:MM" on a fixed minute step across a day (default 15-min). */
export function timeOptions(stepMin = 15): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
}
