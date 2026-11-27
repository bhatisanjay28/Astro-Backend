/**
 * GET /api/v1/calculators/{tool} — Epic 4.4 (Tier 1) + Epic 14 output expansion.
 *
 * Birth-instant tools use the same no-PII birth spec as POST /kundli; every
 * route carries a deterministic `interpretation` block (see engine/
 * interpretations.ts). Astrological verdicts keep the P11 verified:false flags.
 * Quick numerology/fun tools live in calculators-quick.ts.
 */
import { Hono } from "hono";
import {
  antardashasOf,
  destinyNumber,
  ENGINE_VERSION,
  ishtaDevata,
  jaiminiKarakas,
  KARAKA_SCHEME,
  type KundliInput,
  kaalSarp,
  lagna,
  manglik,
  moonPhaseDetails,
  planetaryPositions,
  RASHI_LORDS,
  rashiAndNakshatra,
  sadeSati,
  sunSignDetails,
  vimshottariCurrent,
  vimshottariFromMoon,
} from "../../engine";
import * as ENI from "../../engine/interpretations";
import * as HII from "../../engine/interpretations-hi";
import type { AppEnv } from "../../env";
import { isCalendarDate, validateBirth } from "../../lib/birth";
import { localizeCalcValues } from "../../lib/localize";

export const calculatorsRoute = new Hono<AppEnv>();

/** S24 — ?lang=hi picks the Hindi interpretation layer + localizes values. */
const langOf = (c: { req: { query(name: string): string | undefined } }): "hi" | "en" =>
  c.req.query("lang") === "hi" ? "hi" : "en";
const interp = (lang: "hi" | "en"): typeof ENI => (lang === "hi" ? (HII as typeof ENI) : ENI);

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
const TIME_Q_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function requireDate(c: any): string | null {
  const date = c.req.query("date");
  if (!date || !DATE_Q_RE.test(date) || !isCalendarDate(date)) return null;
  return date;
}

const CONSENT_META = { consent_note: "Birth details are processed on request and are not stored." };

// ---------------------------------------------------------------------------
// Birth-chart Tier 1
// ---------------------------------------------------------------------------

/** GET /calculators/rashi?date&time&lat&lng&tz — Moon sign + nakshatra + meaning. */
calculatorsRoute.get("/calculators/rashi", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const result = rashiAndNakshatra(birth.instant);
  const dasha = vimshottariFromMoon(birth.instant);
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        lord: RASHI_LORDS[result.rashiIndex] ?? "Mars",
        nakshatra_lord: dasha.moon_nakshatra_lord,
        interpretation: interp(lang).interpretNakshatra(
          result.nakshatra,
          dasha.moon_nakshatra_lord,
          result.pada,
        ),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/nakshatra?birth= — Moon's nakshatra focus + dasha anchor. */
calculatorsRoute.get("/calculators/nakshatra", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const result = rashiAndNakshatra(birth.instant);
  const dasha = vimshottariFromMoon(birth.instant);
  return c.json({
    data: localizeCalcValues(
      {
        nakshatra: result.nakshatra,
        nakshatra_index: result.nakshatraIndex,
        pada: result.pada,
        moon_sign: result.rashi,
        nakshatra_lord: dasha.moon_nakshatra_lord,
        balance_at_birth_years: dasha.balance_at_birth_years,
        interpretation: interp(lang).interpretNakshatra(
          result.nakshatra,
          dasha.moon_nakshatra_lord,
          result.pada,
        ),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/lagna?birth= — rising sign (ascendant) + meaning. */
calculatorsRoute.get("/calculators/lagna", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const input = kundliInput(birth);
  const asc = lagna(input);
  const lord = RASHI_LORDS[asc.signIndex] ?? "Mars";
  return c.json({
    data: localizeCalcValues(
      {
        lagna: asc.sign,
        sign_index: asc.signIndex,
        nakshatra: asc.nakshatra,
        pada: asc.pada,
        lord,
        interpretation: interp(lang).interpretLagna(asc.sign, lord),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/vimshottari-dasha?birth= — mahadashas + antardashas + now. */
calculatorsRoute.get("/calculators/vimshottari-dasha", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const result = vimshottariFromMoon(birth.instant);
  const now = new Date();
  const current = vimshottariCurrent(result.mahadashas, now);
  const activeMaha = current
    ? (result.mahadashas.find((m) => m.lord === current.mahadasha_lord) ?? null)
    : null;
  return c.json({
    data: localizeCalcValues(
      {
        moon_nakshatra: result.moon_nakshatra,
        moon_nakshatra_lord: result.moon_nakshatra_lord,
        balance_at_birth_years: result.balance_at_birth_years,
        mahadashas: result.mahadashas,
        current,
        active_antardashas: activeMaha ? antardashasOf(activeMaha) : [],
        interpretation: current
          ? interp(lang).interpretCurrentDasha(current.mahadasha_lord, current.antardasha_lord)
          : null,
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: { ...CONSENT_META, as_of: now.toISOString() },
  });
});

/** GET /calculators/sade-sati?birth=[&as_of=YYYY-MM-DD] — Saturn transit status. */
calculatorsRoute.get("/calculators/sade-sati", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const asOfRaw = c.req.query("as_of");
  let asOf = new Date();
  if (asOfRaw) {
    if (!DATE_Q_RE.test(asOfRaw) || !isCalendarDate(asOfRaw)) {
      return badRequest(c, "as_of must be YYYY-MM-DD");
    }
    asOf = new Date(`${asOfRaw}T12:00:00Z`);
  }
  const result = sadeSati(kundliInput(birth), asOf);
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        interpretation: interp(lang).interpretSadeSati(
          result.in_sade_sati,
          result.phase,
          result.dhaiya_house,
        ),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/kaal-sarp?birth= — hemming check with per-planet table. */
calculatorsRoute.get("/calculators/kaal-sarp", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const input = kundliInput(birth);
  const positions = planetaryPositions(input);
  const asc = lagna(input);
  const result = kaalSarp(positions, asc.lon);
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        interpretation: interp(lang).interpretKaalSarp(
          result.present,
          result.type,
          result.rahu_house,
        ),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/mangal-dosha?birth=[&gender=] — Manglik check (raw + cancelled). */
calculatorsRoute.get("/calculators/mangal-dosha", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const gender = c.req.query("gender");
  if (gender && !["male", "female", "other"].includes(gender)) {
    return badRequest(c, "gender must be male, female or other (optional, informational)");
  }
  const result = manglik(kundliInput(birth));
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        gender: gender ?? null,
        interpretation: interp(lang).interpretManglik(
          result.is_manglik,
          result.cancelled,
          result.cancellation_reason,
        ),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/karakas?birth= — Jaimini char karakas + scheme disclosure. */
calculatorsRoute.get("/calculators/karakas", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const positions = planetaryPositions(kundliInput(birth));
  const karakas = jaiminiKarakas(positions);
  const atma = karakas.find((k) => k.is_atmakaraka) ?? null;
  return c.json({
    data: localizeCalcValues(
      {
        scheme: KARAKA_SCHEME,
        karakas,
        atmakaraka: atma ? atma.planet : null,
        interpretation: atma ? interp(lang).interpretAtmakaraka(atma.planet) : null,
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/ishta-devata?birth= — deity via 12th-from-Karakamsha (P11). */
calculatorsRoute.get("/calculators/ishta-devata", (c) => {
  const lang = langOf(c);
  const birth = birthFromQuery(c);
  if (!birth.ok) return badRequest(c, birth.message);
  const positions = planetaryPositions(kundliInput(birth));
  const result = ishtaDevata(positions);
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        interpretation: interp(lang).interpretIshtaDevata(
          result.ishta_devata,
          result.derivation_source,
        ),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
    meta: CONSENT_META,
  });
});

/** GET /calculators/moon-phase?date&[time=HH:MM UTC] — phase, illumination, neighbours. */
calculatorsRoute.get("/calculators/moon-phase", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const time = c.req.query("time") || "12:00";
  if (!TIME_Q_RE.test(time)) return badRequest(c, "time must be HH:MM (24h, UTC)");
  const instant = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(instant.getTime())) return badRequest(c, "Invalid date");
  const result = moonPhaseDetails(instant);
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        interpretation: interp(langOf(c)).interpretMoonPhase(result.phase),
        engine_version: ENGINE_VERSION,
      },
      langOf(c),
    ),
    meta: { note: "date and time are interpreted in UTC; time defaults to 12:00 UTC" },
  });
});

/** GET /calculators/sun-sign?date=[&time&lat&lng&tz] — tropical + Vedic sun sign. */
calculatorsRoute.get("/calculators/sun-sign", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const hasPlace =
    c.req.query("lat") || c.req.query("lng") || c.req.query("tz") || c.req.query("time");
  let instant: Date | undefined;
  if (hasPlace) {
    const birth = birthFromQuery(c);
    if (!birth.ok) return badRequest(c, birth.message);
    instant = birth.instant;
  }
  const result = sunSignDetails(date, instant);
  const lang = langOf(c);
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        interpretation: interp(lang).interpretSunSign(result.tropical_sign, result.element),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
  });
});

/** GET /calculators/destiny-number?date= — Bhagyank + Mulank with lords. */
calculatorsRoute.get("/calculators/destiny-number", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const result = destinyNumber(date);
  const lang = langOf(c);
  return c.json({
    data: localizeCalcValues(
      {
        ...result,
        interpretation: interp(lang).interpretRoot(
          result.destiny,
          lang === "hi" ? "भाग्यांक" : "Bhagyank",
        ),
        engine_version: ENGINE_VERSION,
      },
      lang,
    ),
  });
});

// ---------------------------------------------------------------------------
// Transits (no birth needed beyond place)
// ---------------------------------------------------------------------------

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
  const now = new Date();
  const input = { datetime: now, latitude: lat, longitude: lng };
  const grahas = planetaryPositions(input).map((g) => ({
    ...g,
    degree_in_sign: Math.round((((g.lon % 30) + 30) % 30) * 100) / 100,
  }));
  return c.json({
    data: {
      as_of: now.toISOString(),
      timezone: tz,
      grahas,
      engine_version: ENGINE_VERSION,
    },
    meta: { cache: "short-lived; positions move continuously" },
  });
});
