/**
 * GET /api/v1/horoscope — 12-sign rashiphal (Epic 5.1 minimal for the home
 * design's horoscope grid; PRD §5.2).
 *
 * Content lives in the `horoscopes` table (admin-editable, PRD §5.2/§7) and is
 * read server-side with the service-role key (D3: no client DB access).
 * `date_key = 'rolling'` rows are evergreen daily content; dated rows land
 * with the admin scheduler (6.4).
 *
 * Query: ?period=daily|yesterday|tomorrow|weekly|monthly|yearly (default daily)
 *        ?lang=en|hi (default en)
 *        ?sign=aries..pisces (optional single-sign filter)
 *
 * Empty result set → 200 with `signs: []` (the UI falls back to its built-in
 * sample lines, same as the seed content).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

const PERIODS = ["yesterday", "daily", "tomorrow", "weekly", "monthly", "yearly"] as const;
const SIGNS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
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

export const horoscopeRoute = new Hono<AppEnv>();

horoscopeRoute.get("/horoscope", async (c) => {
  const q = c.req.query();
  const period = q.period ?? "daily";
  const lang = q.lang ?? "en";
  const sign = q.sign;

  if (!(PERIODS as readonly string[]).includes(period)) {
    return badRequest(c, `period must be one of: ${PERIODS.join(", ")}`, { received: period });
  }
  if (!["en", "hi"].includes(lang)) {
    return badRequest(c, "lang must be en or hi", { received: lang });
  }
  if (sign !== undefined && !(SIGNS as readonly string[]).includes(sign)) {
    return badRequest(c, `sign must be one of: ${SIGNS.join(", ")}`, { received: sign });
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return serviceUnavailable(c);

  const params = new URLSearchParams({
    period: `eq.${period}`,
    lang: `eq.${lang}`,
    status: "eq.published",
    date_key: "eq.rolling",
    select: "sign,overview,love,career,finance,health,is_sample",
    order: "sign.asc",
  });
  if (sign) params.set("sign", `eq.${sign}`);

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/horoscopes?${params.toString()}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
  } catch {
    return c.json({ error: { code: "internal_error", message: "Content lookup failed" } }, 500);
  }
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Content lookup failed" } }, 500);
  }

  const rows = (await res.json()) as Array<{
    sign: string;
    overview: string | null;
    love: string | null;
    career: string | null;
    finance: string | null;
    health: string | null;
    is_sample: boolean;
  }>;

  return c.json({
    data: {
      period,
      lang,
      signs: rows.map((r) => ({
        sign: r.sign,
        overview: r.overview ?? "",
        love: r.love ?? "",
        career: r.career ?? "",
        finance: r.finance ?? "",
        health: r.health ?? "",
        is_sample: r.is_sample,
      })),
    },
  });
});
