/**
 * Shared birth-input validation + UTC-instant resolution (Epic 4.1).
 * The instant solver interprets a LOCAL date+time in an IANA timezone by
 * drift-correction (robust across DST) — extracted from the kundli route so
 * /kundli/match resolves both persons identically.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

  const naive = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naive)) {
    return { ok: false, message: "Invalid date/time" };
  }

  // Interpret date+time in the given IANA timezone (UTC-convert via drift loop).
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  let instant = naive;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const localMinutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
    const drift = localMinutes - 0;
    const dateDrift = localDate < date ? 1 : localDate > date ? -1 : 0;
    if (drift === 0 && dateDrift === 0) break;
    instant -= drift * 60000 + dateDrift * 86400000;
  }
  const [hh, mm] = time.split(":").map(Number);
  return {
    ok: true,
    instant: new Date(instant + (hh ?? 0) * 3600000 + (mm ?? 0) * 60000),
    spec: { date, time, lat, lng, tz },
  };
}
