/**
 * POST /api/v1/kundli — Epic 4.1 (engine-backed, contract v1 envelope).
 *
 * Body: { date: "YYYY-MM-DD", time: "HH:mm", lat, lng, tz } (+ optional
 * `northIndianStyle` display flag handled by the frontend, not here).
 * Optional `options` (Epic 1.9, PRD §8): { ayanamsha, house_system,
 * chart_style } — strict-validated; unknown values → 400. Site-wide defaults
 * come from site_settings via GET /api/v1/settings.
 *
 * NO-PII POLICY (PRD §10): birth data is processed and returned — never
 * persisted. Consent note travels with the response meta.
 */
import { Hono } from "hono";
import {
  divisionalsOf,
  ENGINE_VERSION,
  type EngineConfig,
  engineConfigProblems,
  kaalSarp,
  lagna,
  manglik,
  navamshaSignIndex,
  planetaryPositions,
  resolveEngineConfig,
  sadeSati,
  vimshottariFromMoon,
  wholeSignHouses,
} from "../../engine";
import type { AppEnv } from "../../env";
import { validateBirth } from "../../lib/birth";

interface KundliBody {
  date?: string;
  time?: string;
  lat?: number;
  lng?: number;
  tz?: string;
  options?: Partial<EngineConfig>;
}

export const kundliRoute = new Hono<AppEnv>();

kundliRoute.post("/kundli", async (c) => {
  let body: KundliBody;
  try {
    body = (await c.req.json()) as KundliBody;
  } catch {
    return c.json({ error: { code: "validation_error", message: "Body must be JSON" } }, 400);
  }

  // Epic 1.9 — strict engine-option validation (unknown value → 400).
  const optionProblems = engineConfigProblems(body.options as Record<string, unknown> | undefined);
  if (optionProblems.length > 0) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "options contains unsupported engine configuration values",
          details: optionProblems,
        },
      },
      400,
    );
  }

  const birth = validateBirth(body as Record<string, unknown>);
  if (!birth.ok) {
    return c.json({ error: { code: "validation_error", message: birth.message } }, 400);
  }
  const birthInstant = birth.instant;
  const { date, time: birthTime, lat, lng, tz } = birth.spec;

  const input = { datetime: birthInstant, latitude: lat, longitude: lng };
  const grahas = planetaryPositions(input);
  const asc = lagna(input);
  const houses = wholeSignHouses(grahas, asc.lon);
  const dasha = vimshottariFromMoon(birthInstant);

  const navamsha = Object.fromEntries(grahas.map((p) => [p.planet, navamshaSignIndex(p.lon)]));

  // Epic 1.10 — full divisionals (D3/D7/D9/D10/D12) per graha + Lagna, and
  // Sade Sati from the natal Moon vs the current Saturn transit.
  const divisionals = Object.fromEntries(
    grahas.map((p) => [p.planet, divisionalsOf(p.lon)]),
  ) as Record<string, Record<string, number>>;
  divisionals["Lagna"] = divisionalsOf(asc.lon);
  const sadeSatiNow = sadeSati(input, new Date());
  // Epic 4.4 — Mangal dosha + Kaal Sarp verdicts ride on the same response.
  const manglikNow = manglik(input);
  const kaalSarpNow = kaalSarp(grahas, asc.lon);

  // Epic 1.9 — echo the resolved engine config for the chart renderer.
  const engineConfig = resolveEngineConfig(body.options).config;

  return c.json({
    data: {
      birth: {
        datetime_utc: birthInstant.toISOString(),
        date,
        time: birthTime,
        timezone: tz,
        latitude: lat,
        longitude: lng,
      },
      lagna: asc,
      grahas,
      houses,
      navamsha,
      divisionals,
      sade_sati: sadeSatiNow,
      manglik: manglikNow,
      kaal_sarp: kaalSarpNow,
      dasha,
      engine_version: ENGINE_VERSION,
    },
    meta: {
      consent_note: "Birth details are processed on request and are not stored.",
      chart_styles: ["north_indian", "south_indian"],
      engine_config: engineConfig,
    },
  });
});
