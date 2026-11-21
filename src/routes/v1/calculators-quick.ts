/**
 * GET /api/v1/calculators/{quick-tool} — Epic 4.6 (Tier 2) + Epic 14 (S14-1b).
 *
 * Numerology, Lo Shu, vehicle/mobile readings, age and the "for fun" name
 * games. Split from calculators.ts to keep both files small; mounted in
 * app.ts alongside the birth-chart module. Shared name/date validation.
 */
import { Hono } from "hono";
import {
  ageOn,
  ENGINE_VERSION,
  flames,
  friendshipCompatibility,
  interpretLoShu,
  interpretRoot,
  interpretVehicle,
  loShuGrid,
  loveCompatibility,
  mobileNumerology,
  nameCompatibility,
  nameNumerology,
  numberCompatibility,
  vehicleLuckyNumber,
  vehiclePlateAnalyser,
} from "../../engine";
import type { AppEnv } from "../../env";
import { isCalendarDate } from "../../lib/birth";

export const calculatorsQuickRoute = new Hono<AppEnv>();

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

const DATE_Q_RE = /^\d{4}-\d{2}-\d{2}$/;
function requireDate(c: any, key = "date"): string | null {
  const date = c.req.query(key);
  if (!date || !DATE_Q_RE.test(date) || !isCalendarDate(date)) return null;
  return date;
}

/** Names: letters/spaces/hyphen/apostrophe, 1–60 chars, must start with a letter. */
const NAME_RE = /^[A-Za-z][A-Za-z\s'-]{0,59}$/;
function requireName(c: any, key = "name"): string | null {
  const v = c.req.query(key)?.trim();
  return v && NAME_RE.test(v) ? v : null;
}

const FOR_FUN_META = { note: "Entertainment only — a paper game with no astrological claim." };

// ---------------------------------------------------------------------------
// Numerology
// ---------------------------------------------------------------------------

/** GET /calculators/numerology?date=[&name=] — Mulank/Bhagyank/Namank full shape. */
calculatorsQuickRoute.get("/calculators/numerology", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const nameParam = c.req.query("name");
  let nameResult: ReturnType<typeof nameNumerology> | null = null;
  if (nameParam) {
    const name = requireName(c);
    if (!name) return badRequest(c, "name must be 1–60 letters (spaces/hyphens allowed)");
    nameResult = nameNumerology(name);
  }
  const destiny = (n: number, label: string) => ({
    value: n,
    ...interpretRoot(n, label),
  });
  const day = Number(date.slice(8, 10));
  const digits = date.replace(/\D/g, "").split("").map(Number);
  const dr = (n: number): number =>
    n > 9
      ? dr(
          String(n)
            .split("")
            .reduce((a, x) => a + Number(x), 0),
        )
      : n;
  const mulank = dr(day);
  const bhagyank = dr(digits.reduce((a, x) => a + x, 0));
  return c.json({
    data: {
      mulank: destiny(mulank, "Mulank"),
      bhagyank: destiny(bhagyank, "Bhagyank"),
      name: nameResult
        ? {
            sum: nameResult.sum,
            root: nameResult.root,
            lord: nameResult.lord,
            ...interpretRoot(nameResult.root, "Namank"),
          }
        : null,
      engine_version: ENGINE_VERSION,
    },
  });
});

/** GET /calculators/lo-shu?date= — 3×3 grid, missing/repeated, 8 lines. */
calculatorsQuickRoute.get("/calculators/lo-shu", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const result = loShuGrid(date);
  return c.json({
    data: {
      ...result,
      interpretation: interpretLoShu(result.missing, result.repeated),
      engine_version: ENGINE_VERSION,
    },
  });
});

/** GET /calculators/vehicle-number?date= — lucky vehicle numbers + friend/enemy matrix. */
calculatorsQuickRoute.get("/calculators/vehicle-number", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const result = vehicleLuckyNumber(date);
  return c.json({
    data: {
      ...result,
      interpretation: interpretVehicle("Lucky vehicle numbers"),
      verified: false,
      engine_version: ENGINE_VERSION,
    },
  });
});

/** GET /calculators/vehicle-plate?plate=&date= — dual-school plate analysis (D-QN03). */
calculatorsQuickRoute.get("/calculators/vehicle-plate", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const plate = c.req
    .query("plate")
    ?.toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!plate || plate.length < 4 || plate.length > 12) {
    return badRequest(c, "plate is required (4–12 alphanumeric characters, e.g. DL8CAF1234)");
  }
  const result = vehiclePlateAnalyser(plate, date);
  return c.json({
    data: {
      ...result,
      interpretation: interpretVehicle(result.verdict),
      engine_version: ENGINE_VERSION,
    },
  });
});

/** GET /calculators/mobile-numerology?digits= — Chaldean digit sum (prefix stripped). */
calculatorsQuickRoute.get("/calculators/mobile-numerology", (c) => {
  const digits = c.req.query("digits") ?? "";
  const clean = digits.replace(/\D/g, "");
  if (clean.length < 3 || clean.length > 15) {
    return badRequest(c, "digits must contain 3–15 numeric characters");
  }
  const result = mobileNumerology(digits);
  if (result.sum === 0) return badRequest(c, "digits must sum to a positive value");
  return c.json({
    data: {
      ...result,
      interpretation: interpretRoot(result.root, "Mobile root"),
      for_fun: true,
      engine_version: ENGINE_VERSION,
    },
  });
});

/** GET /calculators/name-numerology?name=[&date=] — Chaldean reading with
 *  letter values; optional owner date adds root-vs-owner compatibility. */
calculatorsQuickRoute.get("/calculators/name-numerology", (c) => {
  const name = requireName(c);
  if (!name) return badRequest(c, "name must be 1–60 letters (spaces/hyphens allowed)");
  const result = nameNumerology(name);
  const dateParam = c.req.query("date");
  let ownerCompatibility: ReturnType<typeof numberCompatibility> | null = null;
  if (dateParam) {
    if (!DATE_Q_RE.test(dateParam) || !isCalendarDate(dateParam)) {
      return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
    }
    ownerCompatibility = numberCompatibility(result.root, dateParam);
  }
  return c.json({
    data: {
      ...result,
      owner_compatibility: ownerCompatibility,
      interpretation: interpretRoot(result.root, "Name root"),
      engine_version: ENGINE_VERSION,
    },
  });
});

/** GET /calculators/age?date=&[now=] — exact age with totals + next birthday. */
calculatorsQuickRoute.get("/calculators/age", (c) => {
  const date = requireDate(c);
  if (!date) return badRequest(c, "date must be a valid YYYY-MM-DD calendar date");
  const now = c.req.query("now") ?? new Date().toISOString().slice(0, 10);
  if (!DATE_Q_RE.test(now) || !isCalendarDate(now)) {
    return badRequest(c, "now must be a valid YYYY-MM-DD calendar date");
  }
  if (now < date) return badRequest(c, "now must not be before the birth date");
  const result = ageOn(date, now);
  return c.json({ data: { ...result, engine_version: ENGINE_VERSION } });
});

// ---------------------------------------------------------------------------
// Name games (for fun)
// ---------------------------------------------------------------------------

function twoNames(c: any): { a: string; b: string } | null {
  const a = requireName(c, "a");
  const b = requireName(c, "b");
  return a && b ? { a, b } : null;
}

calculatorsQuickRoute.get("/calculators/name-compatibility", (c) => {
  const names = twoNames(c);
  if (!names) return badRequest(c, "a and b names must be 1–60 letters each");
  return c.json({
    data: { ...nameCompatibility(names.a, names.b), for_fun: true, engine_version: ENGINE_VERSION },
    meta: FOR_FUN_META,
  });
});

calculatorsQuickRoute.get("/calculators/flames", (c) => {
  const names = twoNames(c);
  if (!names) return badRequest(c, "a and b names must be 1–60 letters each");
  return c.json({
    data: { ...flames(names.a, names.b), for_fun: true, engine_version: ENGINE_VERSION },
    meta: FOR_FUN_META,
  });
});

calculatorsQuickRoute.get("/calculators/love", (c) => {
  const names = twoNames(c);
  if (!names) return badRequest(c, "a and b names must be 1–60 letters each");
  return c.json({
    data: { ...loveCompatibility(names.a, names.b), for_fun: true, engine_version: ENGINE_VERSION },
    meta: FOR_FUN_META,
  });
});

calculatorsQuickRoute.get("/calculators/friendship", (c) => {
  const names = twoNames(c);
  if (!names) return badRequest(c, "a and b names must be 1–60 letters each");
  return c.json({
    data: {
      ...friendshipCompatibility(names.a, names.b),
      for_fun: true,
      engine_version: ENGINE_VERSION,
    },
    meta: FOR_FUN_META,
  });
});
