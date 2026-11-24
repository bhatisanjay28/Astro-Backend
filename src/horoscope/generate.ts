/**
 * Horoscope generator orchestrator (Horoscope Upgrade Step 4; automation reqs #1–#5, #8).
 *
 * Pipeline per run:
 *   1. resolve IST windows: daily buffer (D-1 … D+6), current + next week /
 *      month / year (boundary buffers) — yesterday/tomorrow tabs resolve via
 *      the API to daily rows for the adjacent date, so no duplicate rows.
 *   2. one sidereal snapshot per IST day (cached, sign-independent).
 *   3. compose payloads for 12 signs × 2 langs × all windows (library pick →
 *      fallback), with the daily no-repeat dodge fed by previous payloads.
 *   4. validate (ruleset §10, rules 1–7) → publish only passing rows.
 *   5. upsert horoscopes (payload + legacy text columns) + append run log.
 *
 * Deterministic: same instant → same rows (hash selection; idempotent
 * upsert on (sign, period, date_key, lang)). Failures never throw — the
 * cron logs and the health endpoint reports the last run (req #5 alerting).
 */
import { rest, type SupabaseCreds } from "../lib/supabase";
import {
  type ComposeCtx,
  composeHoroscope,
  type HoroscopePayload,
  type HoroscopePeriod,
  type Lang,
  type PickResult,
} from "./compose";
import { fallbackForSlot } from "./fallback";
import { addDays, istDateKey, periodDateKey } from "./ist";
import { HOROSCOPE_SIGNS, type HoroscopeSign, type Rating } from "./rules";
import { type Snapshot, snapshotAt } from "./score";
import { type LibraryRow, pickVariant, type VariantPool } from "./select";
import { type ValidationRow, type Violation, validateBatch } from "./validate";

export interface GenerateResult {
  status: "success" | "partial" | "failed";
  published: number;
  violations: Violation[];
  durationMs: number;
  ranAt: string;
}

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type LibraryIndex = Map<string, LibraryRow[]>;

const libKey = (slot: string, condition: string, lang: Lang) => `${slot}|${condition}|${lang}`;

async function loadLibrary(creds: SupabaseCreds): Promise<LibraryIndex> {
  const index: LibraryIndex = new Map();
  const res = await rest(
    creds,
    "horoscope_library?select=slot,condition,lang,variant_no,text&is_active=eq.true",
  );
  if (!res.ok) return index; // empty library → full fallback mode (honest empty state)
  const rows = (await res.json()) as LibraryRow[];
  for (const row of rows) {
    const key = libKey(row.slot, row.condition, row.lang as Lang);
    const list = index.get(key) ?? [];
    list.push(row);
    index.set(key, list);
  }
  return index;
}

function makePick(lib: LibraryIndex, dateKey: string, sign: HoroscopeSign, lang: Lang) {
  return (
    slot: string,
    condition: string,
    rating: Rating,
    recentVariants?: number[],
  ): PickResult => {
    const rows = lib.get(libKey(slot, condition, lang)) ?? [];
    const pool: VariantPool = { rows, fallback: fallbackForSlot(slot, rating) };
    return pickVariant({ dateKey, sign, lang, slot, condition, recentVariants }, pool);
  };
}

/** slot → variant numbers used on D-1/D-2 for one (sign, lang), from the batch-prev fetch. */
function recentFor(
  prevDaily: Array<{ sign: string; lang: string; payload: HoroscopePayload }>,
  sign: HoroscopeSign,
  lang: Lang,
): Map<string, number[]> {
  const recent = new Map<string, number[]>();
  for (const row of prevDaily) {
    if (row.sign !== sign || row.lang !== lang) continue;
    for (const [slot, variantNo] of Object.entries(row.payload.variants ?? {})) {
      if (variantNo === null) continue;
      const list = recent.get(slot) ?? [];
      list.push(variantNo);
      recent.set(slot, list);
    }
  }
  return recent;
}

interface TargetRow {
  period: HoroscopePeriod;
  dateKey: string;
  sign: HoroscopeSign;
  lang: Lang;
  snaps: Snapshot[];
  ctx: ComposeCtx;
}

/** Window dates the run covers (IST). */
export function runWindows(now: Date): Array<{ period: HoroscopePeriod; dateKey: string }> {
  const today = istDateKey(now);
  const targets: Array<{ period: HoroscopePeriod; dateKey: string }> = [];
  for (let i = -1; i <= 6; i++) targets.push({ period: "daily", dateKey: addDays(today, i) });
  targets.push({ period: "weekly", dateKey: periodDateKey("weekly", now) });
  targets.push({ period: "weekly", dateKey: addDays(periodDateKey("weekly", now), 7) });
  targets.push({ period: "monthly", dateKey: periodDateKey("monthly", now) });
  targets.push({ period: "monthly", dateKey: nextMonth(periodDateKey("monthly", now)) });
  targets.push({ period: "yearly", dateKey: periodDateKey("yearly", now) });
  targets.push({ period: "yearly", dateKey: String(Number(periodDateKey("yearly", now)) + 1) });
  return targets;
}

function nextMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Days an IST window covers, expressed as dateKeys. */
function windowDays(period: HoroscopePeriod, dateKey: string): string[] {
  switch (period) {
    case "daily":
      return [dateKey];
    case "weekly": {
      const days: string[] = [];
      for (let i = 0; i < 7; i++) days.push(addDays(dateKey, i));
      return days;
    }
    case "monthly": {
      const days: string[] = [];
      let cursor = `${dateKey}-01`;
      while (cursor.startsWith(`${dateKey}-`)) {
        days.push(cursor);
        cursor = addDays(cursor, 1);
      }
      return days;
    }
    case "yearly": {
      const days: string[] = [];
      let cursor = `${dateKey}-01-01`;
      while (cursor.startsWith(`${dateKey}-`)) {
        days.push(cursor);
        cursor = addDays(cursor, 1);
      }
      return days;
    }
    default:
      return [dateKey];
  }
}

/** Legacy column mapping — old frontend shape keeps rendering during rollout. */
function legacyColumns(payload: HoroscopePayload): {
  overview: string | null;
  love: string | null;
  career: string | null;
  finance: string | null;
  health: string | null;
} {
  const area = (key: string): string | null =>
    payload.areas?.[key]?.text ?? payload.year_areas?.[key]?.text ?? null;
  return {
    overview: payload.overview.text,
    love: area("love") ?? area("marriage"),
    career: area("career"),
    finance: area("money") ?? area("wealth"),
    health: area("health"),
  };
}

export async function generateHoroscopes(env: Env): Promise<GenerateResult> {
  const startedAt = Date.now();
  const ranAt = new Date().toISOString();
  const finish = async (
    status: "success" | "failed" | "partial",
    published: number,
    violations: Violation[],
  ): Promise<GenerateResult> => {
    const result: GenerateResult = {
      status,
      published,
      violations,
      durationMs: Date.now() - startedAt,
      ranAt,
    };
    await logRun(env, result).catch(() => {}); // run-log write must not mask the outcome
    return result;
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[horoscope] generation skipped: no backend credentials");
    return finish("failed", 0, []);
  }
  const creds: SupabaseCreds = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };

  try {
    const now = new Date();
    const lib = await loadLibrary(creds);
    const snapCache = new Map<string, Snapshot>();
    const snapFor = (dateKey: string): Snapshot => {
      const cached = snapCache.get(dateKey);
      if (cached) return cached;
      // 00:05 IST convention — houses are zodiacal so the anchor time only pins the ephemeris instant
      const snap = snapshotAt(new Date(Date.parse(`${dateKey}T00:05:00+05:30`)));
      snapCache.set(dateKey, snap);
      return snap;
    };

    // previous payloads for the daily variety rule (§10.5): D-1 and D-2
    const today = istDateKey(now);
    const prevDaily = await loadPrevPayloads(creds, "daily", [
      addDays(today, -1),
      addDays(today, -2),
    ]);

    const rows: ValidationRow[] = [];
    const composeErrors: Violation[] = [];
    for (const { period, dateKey } of runWindows(now)) {
      const days = windowDays(period, dateKey);
      for (const sign of HOROSCOPE_SIGNS) {
        for (const lang of ["en", "hi"] as Lang[]) {
          const recent = period === "daily" ? recentFor(prevDaily, sign, lang) : undefined;
          const ctx: ComposeCtx = {
            lang,
            pick: makePick(lib, dateKey, sign, lang),
            ...(recent && recent.size > 0 ? { recent } : {}),
          };
          let payload: HoroscopePayload;
          try {
            payload = composeHoroscope({ period, sign, dateKey, snaps: days.map(snapFor), ctx });
          } catch (err) {
            // one bad row must not fail the run — the §10 coverage rule flags the gap
            console.error(`[horoscope] compose failed ${sign}/${period}/${dateKey}/${lang}:`, err);
            composeErrors.push({
              rule: 1,
              sign,
              lang,
              detail: `compose error for ${period} ${dateKey}`,
            });
            continue;
          }
          rows.push({ period, sign, lang, dateKey, payload });
        }
      }
    }

    // §10 gate — publish only passing rows; violations feed the run log/health
    const { ok, violations } = validateBatch(
      rows,
      prevDaily.map((p) => ({
        sign: p.sign as HoroscopeSign,
        lang: p.lang as Lang,
        payload: p.payload,
      })),
    );
    const allViolations = [...composeErrors, ...violations];
    const failing = new Set(allViolations.map((v) => `${v.sign}|${v.lang}`));
    // blame is per (sign, lang) — conservative: a violated pair republishes on the next clean run
    const publishable = ok ? rows : rows.filter((row) => !failing.has(`${row.sign}|${row.lang}`));

    const upserted = await upsertRows(creds, publishable);
    if (!upserted) return finish("failed", 0, allViolations);
    const status = ok ? "success" : upserted > 0 ? "partial" : "failed";
    if (!ok) {
      console.error(
        `[horoscope] validation violations (${allViolations.length}):`,
        allViolations.slice(0, 10),
      );
    }
    return finish(status, upserted, allViolations); // also writes the run log
  } catch (err) {
    console.error("[horoscope] generation failed:", err);
    return finish("failed", 0, []);
  }
}

async function loadPrevPayloads(
  creds: SupabaseCreds,
  period: HoroscopePeriod,
  dateKeys: string[],
): Promise<Array<{ sign: string; lang: string; payload: HoroscopePayload }>> {
  const list = dateKeys.map((k) => `date_key.eq.${k}`).join(",");
  const res = await rest(
    creds,
    `horoscopes?select=sign,lang,payload&period=eq.${period}&or=(${list})`,
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    sign: string;
    lang: string;
    payload: HoroscopePayload | null;
  }>;
  return rows
    .filter((r) => r.payload)
    .map((r) => ({ sign: r.sign, lang: r.lang, payload: r.payload! }));
}

async function upsertRows(creds: SupabaseCreds, rows: ValidationRow[]): Promise<number | null> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const body = rows.map((row) => ({
    sign: row.sign,
    period: row.period,
    date_key: row.dateKey,
    lang: row.lang,
    ...legacyColumns(row.payload),
    status: "published",
    publish_at: now,
    is_sample: false,
    payload: row.payload,
  }));
  const res = await rest(creds, "horoscopes?on_conflict=sign,period,date_key,lang", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[horoscope] upsert failed: ${res.status}`);
    return null;
  }
  return body.length;
}

async function logRun(env: Env, result: GenerateResult): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const creds: SupabaseCreds = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
  await rest(creds, "horoscope_run_log", {
    method: "POST",
    body: JSON.stringify({
      ran_at: result.ranAt,
      status: result.status,
      published: result.published,
      violations: result.violations,
      duration_ms: result.durationMs,
    }),
  });
}
