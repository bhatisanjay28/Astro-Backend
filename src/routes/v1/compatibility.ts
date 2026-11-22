/**
 * GET /api/v1/compatibility/signs + /api/v1/compatibility/signs/pair —
 * Epic ZC (Western sun-sign compatibility, S-ZC-2).
 *
 * Read-only, cache-friendly GETs with NO personal data submitted (no birth
 * details — no-PII by construction). Pair results are symmetric: (a, b)
 * canonicalises to one record per unordered pair (78 unique covering all 144
 * ordered lookups). Content SIGNED OFF by the owner 2026-11-22 →
 * `verified: true` (this set only; other P11 engines keep their own flag) —
 * the method framing + guidance disclaimer stay. Editorial content lives
 * with the engine (D12); this route only validates and assembles.
 */
import { Hono } from "hono";
import {
  isZodiacSign,
  PAIR_CONTENT_COUNT,
  SIGN_META,
  signPairResult,
  UnknownSignError,
  ZODIAC_SIGNS,
} from "../../engine";
import type { AppEnv } from "../../env";

export const compatibilityRoute = new Hono<AppEnv>();

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

const META = {
  note: "Sun-sign compatibility is an interpretive method, not a scientific measure — guidance and entertainment only.",
};

/** GET /compatibility/signs — the 12 signs for selectors/hubs (wheel order). */
compatibilityRoute.get("/compatibility/signs", (c) => {
  const signs = ZODIAC_SIGNS.map((slug) => {
    const meta = SIGN_META[slug];
    return {
      slug,
      name: meta.name,
      sanskrit: meta.sanskrit,
      element: meta.element,
      modality: meta.modality,
      polarity: meta.polarity,
      ruler: meta.ruler,
      co_ruler: meta.coRuler,
      approximate_dates: meta.approxDates,
    };
  });
  return c.json({ data: { signs }, meta: META });
});

/**
 * GET /compatibility/signs/pair?sign1=&sign2= — full symmetric result.
 * Same sign allowed (conjunction pairs are nuanced, not auto-perfect).
 */
compatibilityRoute.get("/compatibility/signs/pair", (c) => {
  const sign1 = c.req.query("sign1");
  const sign2 = c.req.query("sign2");

  const missing = [!sign1 && "sign1", !sign2 && "sign2"].filter(Boolean);
  if (missing.length > 0) {
    return badRequest(c, `missing required query parameter(s): ${missing.join(", ")}`, missing);
  }
  if (!isZodiacSign(sign1) || !isZodiacSign(sign2)) {
    return badRequest(
      c,
      "unknown zodiac sign — use lowercase slugs from GET /api/v1/compatibility/signs",
      { sign1: sign1 ?? null, sign2: sign2 ?? null },
    );
  }

  try {
    const result = signPairResult(sign1!, sign2!);
    return c.json({ data: result, meta: META });
  } catch (err) {
    if (err instanceof UnknownSignError) return badRequest(c, err.message);
    // Missing editorial content is a deploy-time gap, not a user error —
    // fail soft with 503 so the frontend renders its honest empty state.
    console.error(
      `compatibility pair content unavailable (${PAIR_CONTENT_COUNT} records loaded)`,
      err,
    );
    return c.json(
      {
        error: {
          code: "content_unavailable",
          message: "compatibility content is not deployed for this pair",
        },
      },
      503,
    );
  }
});
