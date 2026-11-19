/**
 * GET /api/v1/calculators/{tool} — Epic 4.4 (Tier 1) + 4.6 (Tier 2), PRD §5.7.
 *
 * Deterministic GET endpoints; birth-instant tools use the same no-PII birth
 * spec as POST /kundli. Fun tools (flames/love/friendship) carry for_fun
 * flags. All astrological verdicts keep the P11 verified:false flags.
 */
import { Hono } from "hono";
import {
  ageOn,
  ENGINE_VERSION,
  flames,
  friendshipCompatibility,
  ishtaDevata,
  jaiminiKarakas,
  type KundliInput,
  kaalSarp,
  lagna,
  loShuGrid,
  loveCompatibility,
  mobileNumerology,
  nameCompatibility,
  nameNumerology,
  planetaryPositions,
  rashiAndNakshatra,
  sadeSati,
  vehicleLuckyNumber,
} from "../../engine";
import type { AppEnv } from "../../env";
import { validateBirth } from "../../lib/birth";

export const calculatorsRoute = new Hono<AppEnv>();

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

/** Birth params arrive as query strings (GET, cache-friendly, no-PII). */
function birthFromQuery(c: any): ReturnType<typeof validateBirth> {
  return validateBirth({
    date: c.req.query("date"),
    time: c.req.query("time") || undefined,
    lat: Number(c.req.query("lat")),
    lng: Number(c.req.query("lng")),
    tz: c.req.query("tz"),
  });
}

function kundliInput(birth: { instant: Date; spec: { lat: number; lng: number } }): KundliInput {
  return { datetime: birth.instant, latitude: birth.spec.lat, longitude: birth.spec.lng };
}

const DATE_Q_RE = /^\d{4}-\d{2}-\d{2}$/;
function requireDate(c: any): string | null {
  const date = c.req.query("date");
  if (!date || !DATE_Q_RE.test(date)) return null;
  return date;
}

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

/** GET /calculators/rashi?date&time&lat&lng&tz — Moon sign + nakshatra. */
calculatorsRoute.get("/calculators/rashi", (c) => {
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const result = rashiAndNakshatra(birth.instant);
  return c.json({
    data: { ...result, engine_version: ENGINE_VERSION },
    meta: { consent_note: "Birth details are processed on request and are not stored." },
  });
});

/** GET /calculators/sade-sati — Saturn transit status for a birth chart. */
calculatorsRoute.get("/calculators/sade-sati", (c) => {
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const result = sadeSati(kundliInput(birth), new Date());
  return c.json({
    data: { ...result, engine_version: ENGINE_VERSION },
    meta: { consent_note: "Birth details are processed on request and are not stored." },
  });
});

/** GET /calculators/kaal-sarp — hemming check between Rahu and Ketu. */
calculatorsRoute.get("/calculators/kaal-sarp", (c) => {
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const input = kundliInput(birth);
  const positions = planetaryPositions(input);
  const asc = lagna(input);
  return c.json({
    data: { ...kaalSarp(positions, asc.lon), engine_version: ENGINE_VERSION },
    meta: { consent_note: "Birth details are processed on request and are not stored." },
  });
});

/** GET /calculators/karakas — Jaimini char karakas (Atmakaraka/Darakaraka…). */
calculatorsRoute.get("/calculators/karakas", (c) => {
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const positions = planetaryPositions(kundliInput(birth));
  return c.json({
    data: { karakas: jaiminiKarakas(positions), engine_version: ENGINE_VERSION },
    meta: { consent_note: "Birth details are processed on request and are not stored." },
  });
});

/** GET /calculators/ishta-devata — Atmakaraka + navamsha sign (deity table P11). */
calculatorsRoute.get("/calculators/ishta-devata", (c) => {
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const positions = planetaryPositions(kundliInput(birth));
  return c.json({
    data: { ...ishtaDevata(positions), engine_version: ENGINE_VERSION },
    meta: { consent_note: "Birth details are processed on request and are not stored." },
  });
});

// ---------------------------------------------------------------------------
// Tier 2 (pure numerology / fun)
// ---------------------------------------------------------------------------

/** GET /calculators/numerology?date=&name= — Mulank/Destiny/Namank. */
calculatorsRoute.get("/calculators/numerology", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be YYYY-MM-DD");
  const name = c.req.query("name") ?? "";
  const digits = date.replace(/\D/g, "").split("").map(Number);
  const digitalRoot = (n: number): number =>
    n > 9
      ? digitalRoot(
          String(n)
            .split("")
            .reduce((a, x) => a + Number(x), 0),
        )
      : n;
  const mulank = digitalRoot(Number(date.slice(8, 10)));
  const destiny = digitalRoot(digits.reduce((a, x) => a + x, 0));
  const nn = nameNumerology(name);
  return c.json({
    data: {
      mulank,
      destiny,
      name_root: nn.root,
      name_sum: nn.sum,
      name_lord: nn.lord,
      engine_version: ENGINE_VERSION,
    },
  });
});

/** GET /calculators/name-compatibility?a=&b= (for fun). */
calculatorsRoute.get("/calculators/name-compatibility", (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");
  if (!a || !b) return badRequest(c, "a and b name parameters are required");
  return c.json({
    data: { ...nameCompatibility(a, b), for_fun: true, engine_version: ENGINE_VERSION },
  });
});

/** GET /calculators/flames?a=&b= (for fun). */
calculatorsRoute.get("/calculators/flames", (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");
  if (!a || !b) return badRequest(c, "a and b name parameters are required");
  return c.json({ data: { ...flames(a, b), for_fun: true, engine_version: ENGINE_VERSION } });
});

/** GET /calculators/love?a=&b= (for fun). */
calculatorsRoute.get("/calculators/love", (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");
  if (!a || !b) return badRequest(c, "a and b name parameters are required");
  return c.json({
    data: { ...loveCompatibility(a, b), for_fun: true, engine_version: ENGINE_VERSION },
  });
});

/** GET /calculators/friendship?a=&b= (for fun). */
calculatorsRoute.get("/calculators/friendship", (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");
  if (!a || !b) return badRequest(c, "a and b name parameters are required");
  return c.json({
    data: { ...friendshipCompatibility(a, b), for_fun: true, engine_version: ENGINE_VERSION },
  });
});

/** GET /calculators/lo-shu?date= — 3×3 grid from the birth date. */
calculatorsRoute.get("/calculators/lo-shu", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be YYYY-MM-DD");
  return c.json({ data: { ...loShuGrid(date), engine_version: ENGINE_VERSION } });
});

/** GET /calculators/vehicle-number?date= — lucky vehicle numbers. */
calculatorsRoute.get("/calculators/vehicle-number", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be YYYY-MM-DD");
  return c.json({
    data: { ...vehicleLuckyNumber(date), verified: false, engine_version: ENGINE_VERSION },
  });
});

/** GET /calculators/mobile-numerology?digits= (for fun). */
calculatorsRoute.get("/calculators/mobile-numerology", (c) => {
  const digits = c.req.query("digits") ?? "";
  if (!/\d{3,15}/.test(digits.replace(/\D/g, ""))) {
    return badRequest(c, "digits must contain 3–15 numeric characters");
  }
  return c.json({
    data: { ...mobileNumerology(digits), for_fun: true, engine_version: ENGINE_VERSION },
  });
});

/** GET /calculators/name-numerology?name= — Chaldean name reading. */
calculatorsRoute.get("/calculators/name-numerology", (c) => {
  const name = c.req.query("name");
  if (!name) return badRequest(c, "name parameter is required");
  return c.json({ data: { ...nameNumerology(name), engine_version: ENGINE_VERSION } });
});

/** GET /calculators/age?date=&now= — exact age (now defaults to today UTC). */
calculatorsRoute.get("/calculators/age", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be YYYY-MM-DD");
  const now = c.req.query("now") ?? new Date().toISOString().slice(0, 10);
  if (!DATE_Q_RE.test(now)) return badRequest(c, "now must be YYYY-MM-DD");
  try {
    return c.json({ data: { ...ageOn(date, now), engine_version: ENGINE_VERSION } });
  } catch {
    return badRequest(c, "Invalid date");
  }
});

/** GET /calculators/transits?lat&lng&tz — planetary positions right now. */
calculatorsRoute.get("/calculators/transits", (c) => {
  const tz = c.req.query("tz");
  if (!tz) return badRequest(c, "tz must be a valid IANA timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return badRequest(c, "tz must be a valid IANA timezone");
  }
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return badRequest(c, "lat must be a number in [-90,90]");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return badRequest(c, "lng must be a number in [-180,180]");
  }
  const input = { datetime: new Date(), latitude: lat, longitude: lng };
  return c.json({
    data: {
      as_of: new Date().toISOString(),
      timezone: tz,
      grahas: planetaryPositions(input),
      engine_version: ENGINE_VERSION,
    },
    meta: { cache: "short-lived; positions move continuously" },
  });
});
