/**
 * IST calendar helpers for the horoscope generator (automation req #8).
 *
 * Every date_key the generator writes is an IST calendar date — never
 * `new Date().toISOString()` (UTC drift after 18:30 UTC would mislabel rows;
 * 2026-11-21 QA sweep proven rule). Weekly windows run Monday→Sunday IST.
 */
export const IST = "Asia/Kolkata";
/** IST is UTC+5:30 with no DST — a fixed offset. */
const IST_OFFSET_MIN = 330;

/** YYYY-MM-DD of an instant in IST. */
export function istDateKey(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** UTC instant of IST midnight (00:00) for a YYYY-MM-DD IST date. */
export function istStartOfDay(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MIN * 60_000);
}

/** Add calendar days to a YYYY-MM-DD key (UTC-safe: keys have no DST edges). */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Day of week (0=Sun … 6=Sat) of a YYYY-MM-DD key. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday-on-or-before dateKey of `dateKey` (IST weekly window start). */
export function weekStart(dateKey: string): string {
  const wd = weekdayOf(dateKey);
  const back = wd === 0 ? 6 : wd - 1;
  return addDays(dateKey, -back);
}

/** List of dateKeys from `start` inclusive through `end` exclusive. */
export function dayRange(start: string, endExclusive: string): string[] {
  const out: string[] = [];
  for (let k = start; k < endExclusive; k = addDays(k, 1)) out.push(k);
  return out;
}

/**
 * The current window's date_key per period, resolved at an instant (IST):
 * daily/yesterday/tomorrow → that calendar day; weekly → its Monday;
 * monthly → YYYY-MM; yearly → YYYY.
 */
export function periodDateKey(period: string, now: Date): string {
  const today = istDateKey(now);
  switch (period) {
    case "yesterday":
      return addDays(today, -1);
    case "tomorrow":
      return addDays(today, 1);
    case "weekly":
      return weekStart(today);
    case "monthly":
      return today.slice(0, 7);
    case "yearly":
      return today.slice(0, 4);
    default:
      return today;
  }
}

/** Days covered by a period window containing `dateKey` (for scoring aggregates). */
export function periodDays(period: string, dateKey: string): { start: string; days: string[] } {
  switch (period) {
    case "yesterday":
    case "daily":
    case "tomorrow":
      return { start: dateKey, days: [dateKey] };
    case "weekly": {
      const start = weekStart(dateKey);
      return { start, days: dayRange(start, addDays(start, 7)) };
    }
    case "monthly": {
      const start = `${dateKey.slice(0, 7)}-01`;
      const nextMonth =
        dateKey.slice(0, 4) + "-" + String(Number(dateKey.slice(5, 7)) + 1).padStart(2, "0");
      const safeNext = nextMonth.endsWith("-13")
        ? `${Number(dateKey.slice(0, 4)) + 1}-01`
        : nextMonth;
      return { start, days: dayRange(start, `${safeNext}-01`) };
    }
    case "yearly": {
      const y = Number(dateKey.slice(0, 4));
      const out: string[] = [];
      for (let m = 1; m <= 12; m++) {
        const mm = String(m).padStart(2, "0");
        const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
        out.push(...dayRange(`${y}-${mm}-01`, `${nextM}-01`));
      }
      return { start: `${y}-01-01`, days: out };
    }
    default:
      return { start: dateKey, days: [dateKey] };
  }
}
