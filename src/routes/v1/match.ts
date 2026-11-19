/**
 * POST /api/v1/kundli/match — Epic 4.1 (uses the Epic 1.8 Ashtakoota engine).
 *
 * Body: { boy: {date,time?,lat,lng,tz}, girl: {same}, options? } — engine
 * options strict-validated (Epic 1.9).
 *
 * NO-PII POLICY (PRD §10): birth data is processed and returned — never
 * persisted. Ashtakoota/Manglik responses carry `verified: false` pending
 * Jyotishi review (P11).
 */
import { Hono } from "hono";
import {
  ashtakoota,
  ENGINE_VERSION,
  type EngineConfig,
  engineConfigProblems,
  manglik,
} from "../../engine";
import type { AppEnv } from "../../env";
import { validateBirth } from "../../lib/birth";

interface MatchBody {
  boy?: Record<string, unknown>;
  girl?: Record<string, unknown>;
  options?: Partial<EngineConfig>;
}

export const matchRoute = new Hono<AppEnv>();

matchRoute.post("/kundli/match", async (c) => {
  let body: MatchBody;
  try {
    body = (await c.req.json()) as MatchBody;
  } catch {
    return c.json({ error: { code: "validation_error", message: "Body must be JSON" } }, 400);
  }

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

  const boyBirth = validateBirth(body.boy);
  if (!boyBirth.ok) {
    return c.json(
      { error: { code: "validation_error", message: `boy: ${boyBirth.message}` } },
      400,
    );
  }
  const girlBirth = validateBirth(body.girl);
  if (!girlBirth.ok) {
    return c.json(
      { error: { code: "validation_error", message: `girl: ${girlBirth.message}` } },
      400,
    );
  }

  try {
    const boyInput = {
      datetime: boyBirth.instant,
      latitude: boyBirth.spec.lat,
      longitude: boyBirth.spec.lng,
    };
    const girlInput = {
      datetime: girlBirth.instant,
      latitude: girlBirth.spec.lat,
      longitude: girlBirth.spec.lng,
    };

    const ashtakootaResult = ashtakoota(boyInput, girlInput);
    const manglikBoy = manglik(boyInput);
    const manglikGirl = manglik(girlInput);

    // Classical convention (P11): Manglik–Manglik pairing is considered
    // self-cancelling; a single-side Manglik match is traditionally cautioned.
    let manglik_note: string;
    if (manglikBoy.is_manglik && manglikGirl.is_manglik) {
      manglik_note =
        "Both charts are Manglik — the dosha is traditionally considered mutually cancelled.";
    } else if (manglikBoy.is_manglik || manglikGirl.is_manglik) {
      manglik_note =
        "One chart is Manglik and the other is not — traditionally consulted carefully before proceeding.";
    } else {
      manglik_note = "Neither chart is Manglik.";
    }

    return c.json({
      data: {
        ashtakoota: {
          boy: ashtakootaResult.boy,
          girl: ashtakootaResult.girl,
          kootas: ashtakootaResult.kootas,
          total: ashtakootaResult.total,
          max: ashtakootaResult.max,
          threshold: ashtakootaResult.threshold,
          acceptable: ashtakootaResult.acceptable,
          verified: ashtakootaResult.verified,
        },
        manglik: { boy: manglikBoy, girl: manglikGirl, note: manglik_note },
        engine_version: ENGINE_VERSION,
      },
      meta: {
        consent_note: "Birth details are processed on request and are not stored.",
        verification_note:
          "Ashtakoota and Manglik tables follow widely published variants and are pending Jyotishi review (P11).",
      },
    });
  } catch (err) {
    console.error("[kundli/match]", err);
    return c.json({ error: { code: "internal_error", message: "Match computation failed" } }, 500);
  }
});
