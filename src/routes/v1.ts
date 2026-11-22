import { Hono } from "hono";
import type { AppEnv } from "../env";

/**
 * /api/v1 — versioned API surface (contract v1 in docs/plan/epics.md).
 *
 * Domain routers are mounted here as epics land:
 *   /panchang, /muhurat, /kundli, /calculators, /horoscope,
 *   /astrologers, /pujas, /blog, /requests, /settings, /admin
 */
export const v1Route = new Hono<AppEnv>().get("/", (c) =>
  c.json({
    data: {
      version: "v1",
      contract: "docs/plan/epics.md — API & data contracts v1",
      planned: [
        "GET  /api/v1/panchang?city={slug}&date={YYYY-MM-DD}",
        "GET  /api/v1/muhurat/today?city=",
        "POST /api/v1/muhurat/find",
        "POST /api/v1/kundli",
        "POST /api/v1/kundli/match",
        "GET  /api/v1/calculators/{tool}",
        "GET  /api/v1/horoscope/{sign}/{period}",
        "GET  /api/v1/astrologers",
        "GET  /api/v1/astrologers/{slug}",
        "POST /api/v1/requests/consultation",
        "POST /api/v1/requests/puja",
        "GET  /api/v1/pujas",
        "GET  /api/v1/blog/posts",
        "GET  /api/v1/blog/posts/{slug}",
        "GET  /api/v1/settings/public",
        "*    /api/v1/admin/* (auth: admin/editor)",
      ],
      implemented: [
        "GET /api/v1/panchang (coords + city mode; incl. Hindu month/Samvat, Choghadiya, Hora, server-picked active limbs)",
        "GET /api/v1/horoscope?period=&lang=&sign= (12-sign rashiphal from horoscopes table)",
        "POST /api/v1/newsletter { email, source } (public subscribe/upsert)",
        "GET /api/v1/cities?lang=&country= (public city list from Supabase — D12)",
        "GET /api/v1/content/home?lang= (home content bundle: astrologers, poojas, faqs, blocks — D12)",
        "GET /api/v1/settings (engine config from site_settings + public contact/gemstones — Epic 1.9)",
        "POST /api/v1/kundli/match (Ashtakoota 36-guna + Manglik both sides — Epic 4.1/1.8)",
        "GET /api/v1/calculators/{rashi|sade-sati|kaal-sarp|karakas|ishta-devata|numerology|name-compatibility|flames|love|friendship|lo-shu|vehicle-number|mobile-numerology|name-numerology|age|transits} (Epic 4.4/4.6)",
        "GET /api/v1/astrologers (+/{slug}), GET /api/v1/pujas (+/{slug}, ?category=) — Epic 5.2/5.3 directories",
        "POST /api/v1/requests/consultation, POST /api/v1/requests/puja — booking requests (Epic 5.2/5.3)",
        "GET /api/v1/compatibility/signs (+/pair?sign1=&sign2=) — Western sun-sign compatibility, 78 canonical pairs / 144 ordered lookups (Epic ZC)",
      ],
    },
  }),
);
