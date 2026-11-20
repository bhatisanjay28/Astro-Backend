/**
 * GET /api/v1/content/home — the home page's entire content bundle in one
 * cacheable read (Epic 9.2, D12: the frontend renders; ALL data lives in
 * Supabase with RLS; sample rows carry is_sample = true — P8/P9/P21).
 *
 * Sources (all service-role REST reads, D3):
 *  - astrologers (is_active, public-read policy) → home teaser cards
 *  - pujas       (is_active, public-read policy) → home poojan cards
 *  - faq_items   (section = home, published)      → FAQ accordion
 *  - content_blocks (published, per locale)       → calculators, trust cards,
 *                                                   blog teasers, hero trust,
 *                                                   gemstones teaser
 *
 * Empty DB (no creds configured) → 503 so the UI can show an honest state.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

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

export const contentRoute = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /api/v1/content/blocks?lang=en&prefix=kundli. — keyed published content
// blocks by block_key prefix (Epic 4.2b: admin-authored kundli interpretation
// notes; usable for any future keyed-block surface). Same block store as
// /content/home — a prefix-scoped read so pages don't pull the whole bundle.
// ---------------------------------------------------------------------------

const PREFIX_RE = /^[a-z0-9_-]{1,60}\.$/; // must end with a dot → unambiguous prefix

contentRoute.get("/content/blocks", async (c) => {
  const lang = c.req.query("lang") ?? "en";
  if (!["en", "hi"].includes(lang)) {
    return badRequest(c, "lang must be en or hi", { received: lang });
  }
  const prefix = c.req.query("prefix") ?? "";
  if (!PREFIX_RE.test(prefix)) {
    return badRequest(c, "prefix must be 1–60 chars of a-z 0-9 _ - ending with a dot", {
      received: prefix,
    });
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "Content blocks require backend database credentials, which are not configured on this deployment yet.",
        },
      },
      503,
    );
  }

  const rows = await restGet<{ block_key: string; payload: unknown; is_sample: boolean }>(
    supabaseUrl,
    serviceKey,
    `content_blocks?block_key=like.${encodeURIComponent(prefix)}*&lang=eq.${lang}&status=eq.published&order=block_key.asc&select=block_key,payload,is_sample`,
  );
  if (!rows.ok) {
    return c.json({ error: { code: "internal_error", message: "Content lookup failed" } }, 500);
  }

  const blocks: Record<string, unknown> = {};
  let sample = false;
  for (const b of rows.rows) {
    blocks[b.block_key] = b.payload;
    sample = sample || b.is_sample;
  }
  return c.json({ data: { lang, prefix, blocks, is_sample: sample } });
});

contentRoute.get("/content/home", async (c) => {
  const q = c.req.query();
  const lang = q.lang ?? "en";
  if (!["en", "hi"].includes(lang)) {
    return badRequest(c, "lang must be en or hi", { received: lang });
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "Home content requires backend database credentials, which are not configured on this deployment yet.",
        },
      },
      503,
    );
  }

  const [astro, puja, faq, blocks] = await Promise.all([
    restGet<{
      slug: string;
      name: string;
      title: string;
      about: string;
      expertise: string[];
      languages: string[];
      experience_years: number | null;
      price_per_minute: number | null;
      is_available: boolean;
      availability_label: string;
      accent: string;
      is_sample: boolean;
    }>(
      supabaseUrl,
      serviceKey,
      "astrologers?is_active=eq.true&order=sort_order.asc&select=slug,name,title,about,expertise,languages,experience_years,price_per_minute,is_available,availability_label,accent,is_sample",
    ),
    restGet<{
      slug: string;
      name: string;
      category: string;
      purpose: string | null;
      description: string | null;
      duration: string | null;
      mode: string[];
      includes: string[] | null;
      sample_price: number | null;
      accent: string;
      is_sample: boolean;
    }>(
      supabaseUrl,
      serviceKey,
      "pujas?is_active=eq.true&order=sort_order.asc&select=slug,name,category,purpose,description,duration,mode,includes,sample_price,accent,is_sample",
    ),
    restGet<{ question: string; answer: string; is_sample: boolean }>(
      supabaseUrl,
      serviceKey,
      `faq_items?section=eq.home&lang=eq.${lang}&status=eq.published&order=sort_order.asc&select=question,answer,is_sample`,
    ),
    restGet<{ block_key: string; payload: unknown; is_sample: boolean }>(
      supabaseUrl,
      serviceKey,
      `content_blocks?lang=eq.${lang}&status=eq.published&order=block_key.asc&select=block_key,payload,is_sample`,
    ),
  ]);

  if (!astro.ok || !puja.ok || !faq.ok || !blocks.ok) {
    return c.json({ error: { code: "internal_error", message: "Content lookup failed" } }, 500);
  }

  const blockMap: Record<string, unknown> = {};
  let blocksSample = false;
  for (const b of blocks.rows) {
    blockMap[b.block_key] = b.payload;
    blocksSample = blocksSample || b.is_sample;
  }

  return c.json({
    data: {
      lang,
      astrologers: astro.rows.map((a) => ({
        slug: a.slug,
        name: a.name,
        title: a.title,
        about: a.about,
        expertise: a.expertise,
        languages: a.languages,
        experience_years: a.experience_years,
        rate_per_min: a.price_per_minute === null ? null : Number(a.price_per_minute),
        is_available: a.is_available,
        availability_label: a.availability_label,
        accent: a.accent,
        is_sample: a.is_sample,
      })),
      poojas: puja.rows.map((p) => ({
        slug: p.slug,
        name: p.name,
        category: p.category,
        purpose: p.purpose ?? "",
        description: p.description ?? "",
        duration_label: p.duration ?? "",
        mode: p.mode,
        includes: p.includes ?? [],
        price_inr: p.sample_price === null ? null : Number(p.sample_price),
        accent: p.accent,
        is_sample: p.is_sample,
      })),
      faqs: faq.rows,
      blocks: { ...blockMap, is_sample: blocksSample },
    },
  });
});
