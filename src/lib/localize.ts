/**
 * S24 — response localization for Hindi pages.
 *
 * The engine emits BOTH names everywhere (name + name_hi, lord + lord_hi),
 * so cached payloads stay language-neutral and routes localize at read time:
 * `localizeNames(payload, c.req.query("lang"))` deep-walks the payload and
 * swaps `name` → `name_hi` (and `lord` → `lord_hi`) when lang=hi. EN requests
 * are returned untouched; missing hi variants fall back to the EN name.
 */

export function localizeNames<T>(value: T, lang: string | undefined): T {
  if (lang !== "hi") return value;
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = walk(v);
    // swap after the walk so nested children localize first
    if (typeof out.name === "string" && typeof out.name_hi === "string" && out.name_hi) {
      out.name = out.name_hi;
    }
    if (typeof out.lord === "string" && typeof out.lord_hi === "string" && out.lord_hi) {
      out.lord = out.lord_hi;
    }
    return out;
  }
  return value;
}

import { DEITY_HI, KAAL_SARP_TYPE_HI, MOON_PHASE_HI } from "../engine/interpretations-hi";
/* S24 — calculator value localization. Calculator results carry single-string
   values (rashi, lord, phase, karaka, verdict words) rather than name pairs,
   so lang=hi responses walk strings and swap exact EN matches. Sentences and
   dynamic reasons never match and pass through untouched. */
import { NAKSHATRAS, NAKSHATRAS_HI, PLANETS_HI, SIGNS, SIGNS_HI } from "../engine/names";

const VALUE_HI: Record<string, string> = {
  ...PLANETS_HI,
  ...DEITY_HI,
  ...KAAL_SARP_TYPE_HI,
  ...MOON_PHASE_HI,
  Fire: "अग्नि",
  Earth: "पृथ्वी",
  Air: "वायु",
  Water: "जल",
  Atmakaraka: "आत्मकारक",
  Amatyakaraka: "अमात्यकारक",
  Bhratrikaraka: "भ्रातृकारक",
  Matrikaraka: "मातृकारक",
  Putrakaraka: "पुत्रकारक",
  Gnatikaraka: "ज्ञातिकारक",
  Darakaraka: "दारकारक",
  "highest-degree occupant of the 12th from Karakamsha (D9)":
    "कारकांश से बारहवें भाव में सर्वाधिक अंश वाला ग्रह (D9)",
};
// NOTE: verdict/band words ("Lucky", "Neutral", "Challenging", love/friend
// bands …) are deliberately NOT localized here — the frontend derives status
// classes from the raw EN values before translating display text.
// sign + nakshatra tables map by index, merged in verbatim
for (let i = 0; i < SIGNS.length; i++) VALUE_HI[SIGNS[i] as string] = SIGNS_HI[i] as string;
for (let i = 0; i < NAKSHATRAS.length; i++)
  VALUE_HI[NAKSHATRAS[i] as string] = NAKSHATRAS_HI[i] as string;

export function localizeCalcValues<T>(value: T, lang: string | undefined): T {
  if (lang !== "hi") return value;
  return walkValues(value) as T;
}

function walkValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walkValues);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walkValues(v);
    }
    return out;
  }
  if (typeof value === "string") return VALUE_HI[value] ?? value;
  return value;
}
