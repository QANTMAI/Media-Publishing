/* Wall-clock time in a named zone → UTC instant, DST-correct, no libraries.
 *
 * Algorithm: guess the UTC instant as if the wall time were UTC, ask Intl how
 * that instant renders in the target zone, and correct by the difference.
 * A second pass handles instants that land on a DST transition, where the
 * first correction changes the zone's offset. */

const TZ_LABELS: Record<string, string> = {
  "ET (Eastern)": "America/New_York",
  "CT (Central)": "America/Chicago",
  "MT (Mountain)": "America/Denver",
  "PT (Pacific)": "America/Los_Angeles",
  UTC: "UTC",
  "GMT (London)": "Europe/London",
};

export function ianaZone(label: string): string {
  const zone = TZ_LABELS[label];
  if (!zone) throw new Error(`Unknown time zone label: ${label}`);
  return zone;
}

/** What the given UTC instant reads as on a wall clock in `timeZone`, expressed
 * as a UTC-milliseconds value for arithmetic. */
function wallTimeAsUtcMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Intl renders midnight as hour "24" in some locales/configs — normalize.
  const hour = get("hour") % 24;
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

/**
 * Convert a local wall time ("2026-07-20", "18:00") in a labeled zone
 * (e.g. "ET (Eastern)") to the UTC Date of that instant.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, tzLabel: string): Date {
  const zone = ianaZone(tzLabel);
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (
    !y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm) ||
    m < 1 || m > 12 || d < 1 || d > 31 || hh < 0 || hh > 23 || mm < 0 || mm > 59
  ) {
    throw new Error(`Invalid date/time: ${dateStr} ${timeStr}`);
  }
  const desired = Date.UTC(y, m - 1, d, hh, mm);

  let guess = desired;
  // Two correction passes converge for every real-world zone (offsets are
  // stable except at transitions). A wall time inside a DST spring-forward
  // gap doesn't exist; the fixpoint then settles on the adjacent valid
  // instant (offset by the transition), which is the standard resolution.
  // Fall-back ambiguity (a wall time occurring twice) resolves to whichever
  // offset the second pass lands on — deterministic for a given zone/date.
  for (let i = 0; i < 2; i++) {
    guess = desired - (wallTimeAsUtcMs(guess, zone) - guess);
  }
  return new Date(guess);
}
