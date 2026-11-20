/**
 * Epic 6.4 — Horoscope content admin (PRD §5.2): the horoscopes table the
 * public /horoscope API reads from (Epic 9.2). Rows are unique per
 * (sign, period, date_key, lang); the public read filters status=published.
 * Text sections are capped at 4000 chars each to keep payloads sane.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { rest, restList, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminHoroscopesRoute = new Hono<Env>();

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
];
const PERIODS = ["yesterday", "daily", "tomorrow", "weekly", "monthly", "yearly"];
const SECTIONS = ["overview", "love", "career", "finance", "health"] as const;

const COLUMNS =
  "id,sign,period,date_key,lang,overview,love,career,finance,health,status,publish_at,is_sample,updated_at";

function credsMissing(c: any) {
  return c.json(
    {
      error: {
        code: "service_unavailable",
        message: "Admin endpoints require backend auth credentials.",
      },
    },
    503,
  );
}

const section = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.length <= 4000);

adminHoroscopesRoute.get("/admin/horoscopes", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const q = c.req.query();
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(100, Math.max(1, Number(q.per_page ?? "25") || 25));
  const params = new URLSearchParams({
    select: COLUMNS,
    order: "updated_at.desc",
    limit: String(perPage),
    offset: String((page - 1) * perPage),
  });
  if (q.sign && SIGNS.includes(q.sign)) params.set("sign", `eq.${q.sign}`);
  if (q.period && PERIODS.includes(q.period)) params.set("period", `eq.${q.period}`);
  if (q.lang && ["en", "hi"].includes(q.lang)) params.set("lang", `eq.${q.lang}`);
  if (q.status && ["draft", "published"].includes(q.status)) params.set("status", `eq.${q.status}`);
  const listing = await restList(creds, `horoscopes?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Horoscope listing failed" } }, 500);
  return c.json({
    data: { horoscopes: listing.rows },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

adminHoroscopesRoute.post("/admin/horoscopes", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const sign = typeof body.sign === "string" ? body.sign : "";
  const period = typeof body.period === "string" ? body.period : "";
  const lang = typeof body.lang === "string" && ["en", "hi"].includes(body.lang) ? body.lang : "en";
  const dateKey = typeof body.date_key === "string" && body.date_key ? body.date_key : "rolling";
  const errs: Array<{ field: string; message: string }> = [];
  if (!SIGNS.includes(sign))
    errs.push({ field: "sign", message: `sign must be one of: ${SIGNS.join(", ")}` });
  if (!PERIODS.includes(period))
    errs.push({ field: "period", message: `period must be one of: ${PERIODS.join(", ")}` });
  for (const s of SECTIONS)
    if (!section(body[s])) errs.push({ field: s, message: `${s} must be ≤4000 chars` });
  const status = body.status === "published" ? "published" : "draft";
  if (errs.length > 0) {
    return c.json(
      { error: { code: "validation_error", message: "Invalid horoscope payload", details: errs } },
      400,
    );
  }
  const row: Record<string, unknown> = {
    sign,
    period,
    date_key: dateKey,
    lang,
    status,
    updated_at: new Date().toISOString(),
  };
  for (const s of SECTIONS) if (typeof body[s] === "string") row[s] = body[s];
  if (status === "published" && !row.publish_at) row.publish_at = new Date().toISOString();
  const res = await rest(creds, "horoscopes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    if ((await res.text()).includes("duplicate key")) {
      return c.json(
        {
          error: {
            code: "conflict",
            message: `a row for ${sign}/${period}/${dateKey}/${lang} already exists — PATCH it instead`,
          },
        },
        409,
      );
    }
    return c.json({ error: { code: "internal_error", message: "Horoscope create failed" } }, 500);
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return c.json({ data: rows[0] ?? null }, 201);
});

adminHoroscopesRoute.patch("/admin/horoscopes/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const errs: Array<{ field: string; message: string }> = [];
  for (const s of SECTIONS)
    if (!section(body[s])) errs.push({ field: s, message: `${s} must be ≤4000 chars` });
  if (body.status !== undefined && !["draft", "published"].includes(String(body.status))) {
    errs.push({ field: "status", message: "status must be draft or published" });
  }
  if (errs.length > 0) {
    return c.json(
      { error: { code: "validation_error", message: "Invalid horoscope payload", details: errs } },
      400,
    );
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const s of SECTIONS) if (body[s] !== undefined) patch[s] = body[s];
  if (body.status === "published") patch.publish_at = body.publish_at ?? new Date().toISOString();
  if (body.status === "draft") patch.publish_at = null;
  const res = await rest(creds, `horoscopes?id=eq.${encodeURIComponent(c.req.param("id"))}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Horoscope update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Horoscope not found" } }, 404);
  return c.json({ data: rows[0] });
});
