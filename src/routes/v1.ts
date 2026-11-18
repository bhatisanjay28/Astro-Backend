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
        "GET /api/v1/panchang (coords mode; city mode activates with service credentials)",
      ],
    },
  }),
);
