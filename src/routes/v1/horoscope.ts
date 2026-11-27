/**
 * GET /api/v1/horoscope — 12-sign rashiphal (Horoscope Upgrade Step 4).
 *
 * Resolve-current mode: the visitor asks for a period tab; the API resolves it
 * to the IST-dated row the generator maintains (fixed +05:30 offset — date
 * keys never come from toISOString):
 *   yesterday → daily row @ D-1    daily → daily row @ D    tomorrow → daily row @ D+1
 *   weekly    → current Monday     monthly → YYYY-MM        yearly  → YYYY
 *
 * Each sign row carries the legacy five text columns (home-grid contract,
 * unchanged) plus the generated structured `payload` (chips, areas, lucky,
 * sky, month table…) when present. Fixed page strings (disclaimer, rating
 * labels, lucky "why" templates…) ship in `blocks` from content_blocks —
 * D12: content lives behind the API, not in code.
 *
 * Fallback ladder per period (S23): dated row → latest earlier dated row
 * (reported with its REAL date_key + stale:true — never a wrong date) →
 * legacy `date_key=rolling` row → empty `signs: []` (UI renders its built-in
 * sample lines; honest empty).
 *
 * Query: ?period=daily|yesterday|tomorrow|weekly|monthly|yearly (default daily)
 *        ?lang=en|hi (default en)
 *        ?sign=aries..pisces (optional single-sign filter)
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import type { HoroscopePayload } from "../../horoscope/compose";
import { addDays, istDateKey, periodDateKey } from "../../horoscope/ist";
import { HOROSCOPE_SIGNS } from "../../horoscope/rules";
import { rest, type SupabaseCreds } from "../../lib/supabase";

const PERIODS = ["yesterday", "daily", "tomorrow", "weekly", "monthly", "yearly"] as const;
type RequestedPeriod = (typeof PERIODS)[number];

const BLOCK_KEYS = [
  "horoscope.disclaimer",
  "horoscope.disclosure",
  "horoscope.rating_labels",
  "horoscope.lucky_why",
  "horoscope.sadesati_note",
  "horoscope.chandrashtama_tag",
  "horoscope.headers",
  "horoscope.area_names",
  "horoscope.month_clause_intro",
] as const;

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

function serviceUnavailable(c: any) {
  return c.json(
    {
      error: {
        code: "service_unavailable",
        message:
          "Horoscope content requires backend database credentials, which are not configured on this deployment yet.",
      },
    },
    503,
  );
}

interface HoroscopeRow {
  sign: string;
  period: string;
  date_key: string;
  overview: string | null;
  love: string | null;
  career: string | null;
  finance: string | null;
  health: string | null;
  is_sample: boolean;
  payload: HoroscopePayload | null;
}

/** IST resolve-current mapping: requested tab → (generator period, date_key). */
export function resolveCurrent(
  requested: RequestedPeriod,
  now: Date,
): { period: "daily" | "weekly" | "monthly" | "yearly"; dateKey: string } {
  const today = istDateKey(now);
  switch (requested) {
    case "yesterday":
      return { period: "daily", dateKey: addDays(today, -1) };
    case "tomorrow":
      return { period: "daily", dateKey: addDays(today, 1) };
    case "weekly":
      return { period: "weekly", dateKey: periodDateKey("weekly", now) };
    case "monthly":
      return { period: "monthly", dateKey: periodDateKey("monthly", now) };
    case "yearly":
      return { period: "yearly", dateKey: periodDateKey("yearly", now) };
    default:
      return { period: "daily", dateKey: today };
  }
}

export const horoscopeRoute = new Hono<AppEnv>();

horoscopeRoute.get("/horoscope", async (c) => {
  const q = c.req.query();
  const period = (q.period ?? "daily") as RequestedPeriod;
  const lang = q.lang ?? "en";
  const sign = q.sign;

  if (!(PERIODS as readonly string[]).includes(period)) {
    return badRequest(c, `period must be one of: ${PERIODS.join(", ")}`, { received: period });
  }
  if (!["en", "hi"].includes(lang)) {
    return badRequest(c, "lang must be en or hi", { received: lang });
  }
  if (sign !== undefined && !(HOROSCOPE_SIGNS as readonly string[]).includes(sign)) {
    return badRequest(c, `sign must be one of: ${HOROSCOPE_SIGNS.join(", ")}`, { received: sign });
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return serviceUnavailable(c);
  const creds: SupabaseCreds = { url: supabaseUrl, key: serviceKey };

  const { period: resolvedPeriod, dateKey } = resolveCurrent(period, new Date());

  // ladder: dated generator row → latest earlier dated row (real date +
  // stale flag — S23 "never a wrong date") → legacy rolling row → empty
  const fetchRows = async (p: string, dk: string): Promise<HoroscopeRow[]> => {
    const params = new URLSearchParams({
      period: `eq.${p}`,
      lang: `eq.${lang}`,
      status: "eq.published",
      date_key: `eq.${dk}`,
      select: "sign,period,date_key,overview,love,career,finance,health,is_sample,payload",
      order: "sign.asc",
    });
    if (sign) params.set("sign", `eq.${sign}`);
    const res = await rest(creds, `horoscopes?${params.toString()}`);
    if (!res.ok) throw new Error(`content lookup failed: ${res.status}`);
    return (await res.json()) as HoroscopeRow[];
  };

  /** Latest published dateKey ≤ `beforeInclusive` for this period (all key
   * formats — daily/weekly dates, YYYY-MM, YYYY — sort lexicographically). */
  const fetchLatestKey = async (p: string, beforeInclusive: string): Promise<string | null> => {
    const params = new URLSearchParams({
      period: `eq.${p}`,
      lang: `eq.${lang}`,
      status: "eq.published",
      date_key: `lte.${beforeInclusive}`,
      select: "date_key",
      order: "date_key.desc",
      limit: "1",
    });
    if (sign) params.set("sign", `eq.${sign}`);
    const res = await rest(creds, `horoscopes?${params.toString()}`);
    if (!res.ok) return null; // staleness rung is best-effort
    const list = (await res.json()) as Array<{ date_key: string }>;
    return list[0]?.date_key ?? null;
  };

  let rows: HoroscopeRow[];
  // the date_key the response reports — the CONTENT's own key, not the
  // requested one (they differ only on the stale rung)
  let servedKey = dateKey;
  let stale = false;
  try {
    rows = await fetchRows(resolvedPeriod, dateKey);
    if (rows.length === 0) {
      const latest = await fetchLatestKey(resolvedPeriod, dateKey);
      if (latest && latest !== dateKey) {
        rows = await fetchRows(resolvedPeriod, latest);
        servedKey = latest;
        stale = true;
      }
    }
    // Legacy rolling rows exist for period='daily' only (migration 0003 seed),
    // so every tab falls back to that same batch.
    if (rows.length === 0) rows = await fetchRows("daily", "rolling");
  } catch {
    return c.json({ error: { code: "internal_error", message: "Content lookup failed" } }, 500);
  }

  // fixed page strings for this lang (fail-soft: missing blocks → absent keys)
  let blocks: Record<string, unknown> = {};
  try {
    const params = new URLSearchParams({
      block_key: `in.(${BLOCK_KEYS.join(",")})`,
      lang: `eq.${lang}`,
      status: "eq.published",
      select: "block_key,payload",
    });
    const res = await rest(creds, `content_blocks?${params.toString()}`);
    if (res.ok) {
      const blockRows = (await res.json()) as Array<{ block_key: string; payload: unknown }>;
      blocks = Object.fromEntries(
        blockRows.map((b) => [b.block_key.replace("horoscope.", ""), b.payload]),
      );
    }
  } catch {
    // blocks are enhancement chrome — a lookup miss must not fail the payload
  }

  const payloadRows = rows.filter((r) => r.payload);
  return c.json({
    data: {
      period,
      resolved_period: resolvedPeriod,
      date_key: servedKey,
      /** the IST key the tab asked for — differs from date_key only when the
       * content served is the latest available (stale rung) */
      requested_date_key: dateKey,
      /** true → content is older than the requested window; the UI labels it */
      stale,
      lang,
      range: payloadRows[0]?.payload?.range ?? null,
      blocks,
      signs: rows.map((r) => ({
        sign: r.sign,
        // legacy five-line contract (home grid) — unchanged shape
        overview: r.payload?.overview?.text ?? r.overview ?? "",
        love: r.love ?? "",
        career: r.career ?? "",
        finance: r.finance ?? "",
        health: r.health ?? "",
        is_sample: r.is_sample,
        has_payload: !!r.payload,
        payload: r.payload ?? null,
      })),
    },
  });
});
