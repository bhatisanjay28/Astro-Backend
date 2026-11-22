/**
 * Shared birth-input validation + UTC-instant resolution (Epic 4.1, fixed in
 * Epic 14 QB-01). The instant solver interprets a LOCAL date+time in an IANA
 * timezone by drift-correction toward the TARGET wall clock (robust across
 * DST). The old solver drove the wall clock toward midnight and re-added
 * hh:mm afterwards with an inverted whole-day sign — evening births in
 * positive-offset zones (IST ≥ 18:30) converged past the 3-iteration cap and
 * landed on the wrong day.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when dateISO is a real calendar day (2025-02-30 is not). */
export function isCalendarDate(dateISO: string): boolean {
  if (!DATE_RE.test(dateISO)) return false;
  const [y, m, d] = dateISO.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface BirthSpec {
  date: string;
  time: string; // HH:mm, defaults to "12:00" when omitted
  lat: number;
  lng: number;
  tz: string;
}

export type BirthValidation =
  | { ok: true; instant: Date; spec: BirthSpec }
  | { ok: false; message: string };

export function validateBirth(raw: Record<string, unknown> | undefined): BirthValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "birth details object is required" };
  }
  const date = raw.date;
  const time = (raw.time as string | undefined) ?? "12:00";
  const lat = raw.lat;
  const lng = raw.lng;
  const tz = raw.tz;

  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return { ok: false, message: "date must be YYYY-MM-DD" };
  }
  if (typeof time !== "string" || !TIME_RE.test(time)) {
    return { ok: false, message: "time must be HH:mm (24h)" };
  }
  if (!isCalendarDate(date)) {
    return { ok: false, message: "date is not a valid calendar date" };
  }
  // S18 (owner spec): a birth chart needs a past date — reject future births
  // (UTC-date compare; ISO strings compare lexicographically). Today itself
  // is valid (someone born earlier today).
  const todayISO = new Date().toISOString().slice(0, 10);
  if (date > todayISO) {
    return {
      ok: false,
      message: "date must not be in the future — a birth chart needs a past date",
    };
  }
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, message: "lat must be a number in [-90,90]" };
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, message: "lng must be a number in [-180,180]" };
  }
  if (typeof tz !== "string" || !tz) {
    return { ok: false, message: "tz must be a valid IANA timezone" };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return { ok: false, message: "tz must be a valid IANA timezone" };
  }

  const [hh, mm] = time.split(":").map(Number);
  const targetMinutes = (hh ?? 0) * 60 + (mm ?? 0);
  const targetDayMs = Date.parse(`${date}T00:00:00Z`);

  // Interpret date+time in the given IANA timezone: start by treating the
  // wall clock as UTC, then correct by the observed offset until the tz-local
  // clock reads exactly date+time. Converges in 1–2 iterations for real
  // zones; the cap guards pathological DST jumps. h23 avoids the ICU
  // "24:00" midnight quirk.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = Date.parse(`${date}T${time}:00Z`);
  for (let i = 0; i < 6; i++) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const localMinutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
    const localDayMs = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
    const minuteDrift = localMinutes - targetMinutes;
    const dayDrift = Math.round((localDayMs - targetDayMs) / 86400000);
    if (minuteDrift === 0 && dayDrift === 0) break;
    instant -= minuteDrift * 60000 + dayDrift * 86400000;
  }
  return {
    ok: true,
    instant: new Date(instant),
    spec: { date, time, lat, lng, tz },
  };
}
