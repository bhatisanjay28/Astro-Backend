/**
 * GET /api/v1/astrologers (+/{slug}) and GET /api/v1/pujas (+/{slug}) —
 * Epic 5.2/5.3 public directory endpoints (Supabase, service-role REST, D3).
 * Sample rows keep their is_sample flags (P8/P9).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

async function restGet<T>(
  url: string,
  serviceKey: string,
  path: string,
): Promise<{ ok: true; rows: T[] } | { ok: false }> {
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return { ok: false };
    return { ok: true, rows: (await res.json()) as T[] };
  } catch {
    return { ok: false };
  }
}

function unavailable(c: any, what: string) {
  return c.json(
    {
      error: {
        code: "service_unavailable",
        message: `${what} require backend database credentials, which are not configured on this deployment yet.`,
      },
    },
    503,
  );
}

function failed(c: any, what: string) {
  return c.json({ error: { code: "internal_error", message: `${what} lookup failed` } }, 500);
}

export const directoryRoute = new Hono<AppEnv>();

interface AstrologerRow {
  slug: string;
  name: string;
  title: string | null;
  title_hi: string | null;
  about: string | null;
  about_hi: string | null;
  expertise: string[];
  languages: string[];
  experience_years: number | null;
  price_per_minute: string | number | null;
  session_types: Array<{ type?: string; duration_min?: number }> | null;
  is_available: boolean;
  availability_label: string;
  is_sample: boolean;
}

interface PujaRow {
  slug: string;
  name: string;
  name_hi: string | null;
  category: string;
  purpose: string | null;
  description: string | null;
  description_hi: string | null;
  duration: string | null;
  mode: string[];
  includes: string[] | null;
  sample_price: string | number | null;
  muhurat_note: string | null;
  is_sample: boolean;
}

function astrologerJson(a: AstrologerRow) {
  return {
    slug: a.slug,
    name: a.name,
    title: a.title ?? "",
    title_hi: a.title_hi,
    about: a.about ?? "",
    about_hi: a.about_hi,
    expertise: a.expertise ?? [],
    languages: a.languages ?? [],
    experience_years: a.experience_years,
    rate_per_min: a.price_per_minute === null ? null : Number(a.price_per_minute),
    session_types: a.session_types ?? [],
    is_available: a.is_available,
    availability_label: a.availability_label ?? "",
    is_sample: a.is_sample,
  };
}

function pujaJson(p: PujaRow) {
  return {
    slug: p.slug,
    name: p.name,
    name_hi: p.name_hi,
    category: p.category,
    purpose: p.purpose ?? "",
    description: p.description ?? "",
    description_hi: p.description_hi,
    duration_label: p.duration ?? "",
    mode: p.mode ?? [],
    includes: p.includes ?? [],
    price_inr: p.sample_price === null ? null : Number(p.sample_price),
    muhurat_note: p.muhurat_note ?? "",
    is_sample: p.is_sample,
  };
}

directoryRoute.get("/astrologers", async (c) => {
  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return unavailable(c, "The astrologer directory");
  const rows = await restGet<AstrologerRow>(
    supabaseUrl,
    serviceKey,
    "astrologers?is_active=eq.true&listing_consent_confirmed_at=not.is.null&deleted_at=is.null&order=sort_order.asc&select=slug,name,title,title_hi,about,about_hi,expertise,languages,experience_years,price_per_minute,session_types,is_available,availability_label,is_sample",
  );
  if (!rows.ok) return failed(c, "Astrologer");
  return c.json({ data: { astrologers: rows.rows.map(astrologerJson) } });
});

directoryRoute.get("/astrologers/:slug", async (c) => {
  const slug = c.req.param("slug");
  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return unavailable(c, "The astrologer profile");
  const rows = await restGet<AstrologerRow>(
    supabaseUrl,
    serviceKey,
    `astrologers?is_active=eq.true&listing_consent_confirmed_at=not.is.null&deleted_at=is.null&slug=eq.${encodeURIComponent(slug)}&select=slug,name,title,title_hi,about,about_hi,expertise,languages,experience_years,price_per_minute,session_types,is_available,availability_label,is_sample`,
  );
  if (!rows.ok) return failed(c, "Astrologer");
  const row = rows.rows[0];
  if (!row) {
    return c.json({ error: { code: "not_found", message: "No such astrologer" } }, 404);
  }
  return c.json({ data: astrologerJson(row) });
});

directoryRoute.get("/pujas", async (c) => {
  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return unavailable(c, "The poojan catalogue");
  const q = c.req.query("category");
  const filter = q ? `&category=eq.${encodeURIComponent(q)}` : "";
  const rows = await restGet<PujaRow>(
    supabaseUrl,
    serviceKey,
    `pujas?is_active=eq.true&deleted_at=is.null&order=sort_order.asc&select=slug,name,name_hi,category,purpose,description,description_hi,duration,mode,includes,sample_price,muhurat_note,is_sample${filter}`,
  );
  if (!rows.ok) return failed(c, "Poojan");
  return c.json({ data: { pujas: rows.rows.map(pujaJson) } });
});

directoryRoute.get("/pujas/:slug", async (c) => {
  const slug = c.req.param("slug");
  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return unavailable(c, "The poojan detail");
  const rows = await restGet<PujaRow>(
    supabaseUrl,
    serviceKey,
    `pujas?is_active=eq.true&deleted_at=is.null&slug=eq.${encodeURIComponent(slug)}&select=slug,name,name_hi,category,purpose,description,description_hi,duration,mode,includes,sample_price,muhurat_note,is_sample`,
  );
  if (!rows.ok) return failed(c, "Poojan");
  const row = rows.rows[0];
  if (!row) {
    return c.json({ error: { code: "not_found", message: "No such puja" } }, 404);
  }
  return c.json({ data: pujaJson(row) });
});

// ---------------------------------------------------------------------------
// GET /api/v1/festivals?date=YYYY-MM-DD — festivals/vrats for a day (Epic 3.2b,
// PRD §5.3). Sample seed rows carry is_sample=true (P10); admin-managed later.
// ---------------------------------------------------------------------------

directoryRoute.get("/festivals", async (c) => {
  const date = c.req.query("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: { code: "validation_error", message: "date must be YYYY-MM-DD" } }, 400);
  }
  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return unavailable(c, "Festival data");
  const rows = await restGet<{
    name: string;
    name_hi: string | null;
    date: string | null;
    description: string | null;
    is_sample: boolean;
  }>(
    supabaseUrl,
    serviceKey,
    `festivals?date=eq.${date}&select=name,name_hi,date,description,is_sample&order=name.asc`,
  );
  if (!rows.ok) return failed(c, "Festival");
  return c.json({
    data: {
      date,
      festivals: rows.rows.map((f) => ({
        name: f.name,
        name_hi: f.name_hi,
        description: f.description ?? "",
        is_sample: f.is_sample,
      })),
    },
  });
});
