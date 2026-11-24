/**
 * Horoscope rule-set tables (Horoscope Upgrade Step 4; ruleset 03-ruleset.md).
 *
 * Pure data + tiny helpers. Every table here is the direct transcription of
 * the approved rule set (research/03-ruleset.md §2–§6, §9) — keep the section
 * references in comments when editing so drift is reviewable.
 *
 * Houses are counted zodiacally from the reader's Moon sign (rashi = house 1):
 *   house(p, s) = ((p.signIndex − s) mod 12) + 1
 */
import type { PlanetName } from "../engine/kundli";

export const HOROSCOPE_SIGNS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;
export type HoroscopeSign = (typeof HOROSCOPE_SIGNS)[number];

/** Visitor-facing EN display names (lucky why-lines, sade-sati copy). */
export const SIGN_EN: Record<HoroscopeSign, string> = {
  aries: "Aries",
  taurus: "Taurus",
  gemini: "Gemini",
  cancer: "Cancer",
  leo: "Leo",
  virgo: "Virgo",
  libra: "Libra",
  scorpio: "Scorpio",
  sagittarius: "Sagittarius",
  capricorn: "Capricorn",
  aquarius: "Aquarius",
  pisces: "Pisces",
};

export const SIGN_HI: Record<HoroscopeSign, string> = {
  aries: "मेष",
  taurus: "वृषभ",
  gemini: "मिथुन",
  cancer: "कर्क",
  leo: "सिंह",
  virgo: "कन्या",
  libra: "तुला",
  scorpio: "वृश्चिक",
  sagittarius: "धनु",
  capricorn: "मकर",
  aquarius: "कुम्भ",
  pisces: "मीन",
};

export const SIGN_LORD: Record<HoroscopeSign, PlanetName> = {
  aries: "Mars",
  taurus: "Venus",
  gemini: "Mercury",
  cancer: "Moon",
  leo: "Sun",
  virgo: "Mercury",
  libra: "Venus",
  scorpio: "Mars",
  sagittarius: "Jupiter",
  capricorn: "Saturn",
  aquarius: "Saturn",
  pisces: "Jupiter",
};

/** §2.1 — favorable houses per planet (from Moon sign). */
export const FAVORABLE_HOUSES: Record<PlanetName, number[]> = {
  Sun: [3, 6, 10, 11],
  Moon: [1, 3, 6, 7, 10, 11],
  Mars: [3, 6, 11],
  Mercury: [2, 4, 6, 8, 10, 11],
  Jupiter: [2, 5, 7, 9, 11],
  Venus: [1, 2, 3, 4, 5, 8, 9, 11, 12],
  Saturn: [3, 6, 11],
  Rahu: [3, 6, 11],
  Ketu: [3, 6, 11],
};

/** §2.2 — vedha pairs: goodHouse ← obstructingHouse. Sun/Saturn and Moon/Mercury never obstruct each other. */
export const VEDHA_PAIRS: Record<PlanetName, Record<number, number>> = {
  Sun: { 3: 9, 6: 12, 10: 4, 11: 5 },
  Moon: { 1: 5, 3: 9, 6: 12, 7: 2, 10: 4, 11: 8 },
  Mars: { 3: 12, 6: 9, 11: 5 },
  Mercury: { 2: 5, 4: 3, 6: 9, 8: 1, 10: 8, 11: 12 },
  Jupiter: { 2: 12, 5: 4, 7: 3, 9: 10, 11: 8 },
  Venus: { 1: 8, 2: 7, 3: 1, 4: 10, 5: 9, 8: 5, 9: 11, 11: 6, 12: 3 },
  Saturn: { 3: 12, 6: 9, 11: 5 },
  Rahu: {},
  Ketu: {},
};

/** Vedha exemption pairs (§2.2): these planets never obstruct each other. */
const NEVER_OBSTRUCT: Array<[PlanetName, PlanetName]> = [
  ["Sun", "Saturn"],
  ["Moon", "Mercury"],
];

/** §2.2 [ED] — the Moon is never treated as a standing obstruction for daily texts. */
const MOON_AS_OBSTRUCTOR = false;

export const PLANETS: PlanetName[] = [
  "Sun",
  "Moon",
  "Mars",
  "Mercury",
  "Jupiter",
  "Venus",
  "Saturn",
  "Rahu",
  "Ketu",
];

/** §4.1 — category weights (sparse: only contributing planets; sum to 1 per category). */
export const CATEGORY_WEIGHTS: Record<string, Partial<Record<PlanetName, number>>> = {
  health: { Moon: 0.3, Sun: 0.2, Saturn: 0.2, Mars: 0.15, Rahu: 0.1, Ketu: 0.05 },
  education: { Mercury: 0.4, Jupiter: 0.35, Venus: 0.15, Moon: 0.1 },
  career: { Sun: 0.25, Saturn: 0.25, Mars: 0.2, Mercury: 0.15, Jupiter: 0.15 },
  business: { Mercury: 0.35, Saturn: 0.2, Venus: 0.2, Jupiter: 0.15, Mars: 0.1 },
  wealth: { Jupiter: 0.3, Venus: 0.25, Moon: 0.15, Mercury: 0.15, Saturn: 0.15 },
  love: { Venus: 0.4, Moon: 0.3, Mars: 0.15, Jupiter: 0.15 },
  marriage: { Venus: 0.35, Jupiter: 0.3, Moon: 0.2, Saturn: 0.15 },
  family: { Moon: 0.35, Jupiter: 0.25, Sun: 0.1, Venus: 0.15, Saturn: 0.15 },
  children: { Jupiter: 0.4, Moon: 0.25, Venus: 0.15, Sun: 0.1, Saturn: 0.1 },
};

/** §4.2 — score → rating bands. */
export const RATING_BANDS = ["excellent", "good", "moderate", "challenging"] as const;
export type Rating = (typeof RATING_BANDS)[number];

export const RATING_LABEL: Record<Rating, { en: string; hi: string; glyph: string }> = {
  excellent: { en: "Excellent", hi: "उत्तम", glyph: "▲▲" },
  good: { en: "Good", hi: "अच्छा", glyph: "▲" },
  moderate: { en: "Moderate", hi: "मध्यम", glyph: "◆" },
  challenging: { en: "Challenging", hi: "चुनौतीपूर्ण", glyph: "▼" },
};

export function ratingFromScore(score: number): Rating {
  if (score >= 0.35) return "excellent";
  if (score >= 0.1) return "good";
  if (score > -0.1) return "moderate";
  return "challenging";
}

/** §4.3 — Sade Sati / Dhaiya modifiers on Health, Family, Career. */
export const SATURN_HOUSE_MODIFIER: Record<
  number,
  { phase: string; label: string; label_hi: string; delta: number }
> = {
  12: {
    phase: "rising",
    label: "Sade Sati — rising phase",
    label_hi: "साढ़े साती — प्रथम चरण",
    delta: -0.2,
  },
  1: {
    phase: "peak",
    label: "Sade Sati — peak phase",
    label_hi: "साढ़े साती — चरम चरण",
    delta: -0.25,
  },
  2: {
    phase: "setting",
    label: "Sade Sati — setting phase",
    label_hi: "साढ़े साती — तृतीय चरण",
    delta: -0.2,
  },
  4: { phase: "dhaiya", label: "Dhaiya (Ardhastama)", label_hi: "ढैया", delta: -0.15 },
  8: { phase: "ashtama", label: "Ashtama phase", label_hi: "अष्टम शनि", delta: -0.15 },
};

/** §5 — planetary attribute table (colours/number/direction/deity/mantra). */
export interface PlanetAttributes {
  colours: Array<{ en: string; hi: string; swatch: string }>;
  number: number;
  direction: { en: string; hi: string } | null;
  deity: { en: string; hi: string };
  mantra: { hi: string; en: string };
}

export const PLANET_ATTRIBUTES: Record<PlanetName, PlanetAttributes> = {
  Sun: {
    colours: [
      { en: "Saffron", hi: "केसरिया", swatch: "#FF9933" },
      { en: "Gold", hi: "स्वर्ण", swatch: "#E3B505" },
    ],
    number: 1,
    direction: { en: "East", hi: "पूर्व" },
    deity: { en: "Surya", hi: "सूर्य" },
    mantra: { hi: "ॐ ह्रां ह्रीं ह्रौं सः सूर्याय नमः", en: "Om Hraam Hreem Hraum Sah Suryaya Namah" },
  },
  Moon: {
    colours: [
      { en: "White", hi: "सफ़ेद", swatch: "#F4F4F0" },
      { en: "Silver", hi: "चाँदी", swatch: "#D8DDE3" },
    ],
    number: 2,
    direction: { en: "North-West", hi: "उत्तर-पश्चिम" },
    deity: { en: "Parvati", hi: "पार्वती" },
    mantra: {
      hi: "ॐ श्रां श्रीं श्रौं सः चन्द्राय नमः",
      en: "Om Shraam Shreem Shraum Sah Chandraya Namah",
    },
  },
  Mars: {
    colours: [
      { en: "Red", hi: "लाल", swatch: "#C0392B" },
      { en: "Crimson", hi: "गहरा लाल", swatch: "#922B21" },
    ],
    number: 9,
    direction: { en: "South", hi: "दक्षिण" },
    deity: { en: "Hanuman", hi: "हनुमान" },
    mantra: { hi: "ॐ क्रां क्रीं क्रौं सः भौमाय नमः", en: "Om Kraam Kreem Kraum Sah Bhaumaya Namah" },
  },
  Mercury: {
    colours: [{ en: "Green", hi: "हरा", swatch: "#2E7D4F" }],
    number: 5,
    direction: { en: "North", hi: "उत्तर" },
    deity: { en: "Vishnu", hi: "विष्णु" },
    mantra: { hi: "ॐ ब्रां ब्रीं ब्रौं सः बुधाय नमः", en: "Om Braam Breem Braum Sah Budhaya Namah" },
  },
  Jupiter: {
    colours: [
      { en: "Yellow", hi: "पीला", swatch: "#E3B505" },
      { en: "Gold", hi: "स्वर्ण", swatch: "#D4A017" },
    ],
    number: 3,
    direction: { en: "North-East", hi: "उत्तर-पूर्व" },
    deity: { en: "Brihaspati (Guru)", hi: "बृहस्पति (गुरु)" },
    mantra: { hi: "ॐ ग्रां ग्रीं ग्रौं सः गुरवे नमः", en: "Om Graam Greem Graum Sah Gurave Namah" },
  },
  Venus: {
    colours: [
      { en: "White", hi: "सफ़ेद", swatch: "#F5EFE0" },
      { en: "Cream", hi: "क्रीम", swatch: "#F0E6D2" },
    ],
    number: 6,
    direction: { en: "South-East", hi: "दक्षिण-पूर्व" },
    deity: { en: "Lakshmi", hi: "लक्ष्मी" },
    mantra: { hi: "ॐ द्रां द्रीं द्रौं सः शुक्राय नमः", en: "Om Draam Dreem Draum Sah Shukraya Namah" },
  },
  Saturn: {
    colours: [
      { en: "Blue", hi: "नीला", swatch: "#34495E" },
      { en: "Black", hi: "काला", swatch: "#2C3A47" },
    ],
    number: 8,
    direction: { en: "West", hi: "पश्चिम" },
    deity: { en: "Shani", hi: "शनि" },
    mantra: {
      hi: "ॐ प्रां प्रीं प्रौं सः शनैश्चराय नमः",
      en: "Om Praam Preem Praum Sah Shanaischaraya Namah",
    },
  },
  Rahu: {
    colours: [{ en: "Smoky", hi: "धुँधला", swatch: "#7F8C8D" }],
    number: 4,
    direction: { en: "South-West", hi: "दक्षिण-पश्चिम" },
    deity: { en: "Durga", hi: "दुर्गा" },
    mantra: { hi: "ॐ भ्रां भ्रीं भ्रौं सः राहवे नमः", en: "Om Bhraam Breem Bhraum Sah Rahave Namah" },
  },
  Ketu: {
    colours: [
      { en: "Grey", hi: "स्लेटी", swatch: "#95A5A6" },
      { en: "Brown", hi: "भूरा", swatch: "#8D6E63" },
    ],
    number: 7,
    direction: null, // §5: Ketu is excluded from direction assignment
    deity: { en: "Ganesha", hi: "गणेश" },
    mantra: { hi: "ॐ स्रां स्रीं स्रौं सः केतवे नमः", en: "Om Sraam Sreem Sraum Sah Ketave Namah" },
  },
};

/** Weekday → its planetary lord (§5 rule 2). 0=Sunday. */
export const WEEKDAY_PLANET: PlanetName[] = [
  "Sun",
  "Moon",
  "Mars",
  "Mercury",
  "Jupiter",
  "Venus",
  "Saturn",
];

/** Display names for sky-block lines (§7.5 zero-fabrication data lines). */
export const PLANET_HI: Record<PlanetName, string> = {
  Sun: "सूर्य",
  Moon: "चंद्र",
  Mars: "मंगल",
  Mercury: "बुध",
  Jupiter: "गुरु",
  Venus: "शुक्र",
  Saturn: "शनि",
  Rahu: "राहु",
  Ketu: "केतु",
};

/** Month labels for the yearly month table + sky lines. */
export const MONTH_NAMES: Record<string, { en: string; hi: string }> = {
  "01": { en: "January", hi: "जनवरी" },
  "02": { en: "February", hi: "फरवरी" },
  "03": { en: "March", hi: "मार्च" },
  "04": { en: "April", hi: "अप्रैल" },
  "05": { en: "May", hi: "मई" },
  "06": { en: "June", hi: "जून" },
  "07": { en: "July", hi: "जुलाई" },
  "08": { en: "August", hi: "अगस्त" },
  "09": { en: "September", hi: "सितंबर" },
  "10": { en: "October", hi: "अक्टूबर" },
  "11": { en: "November", hi: "नवंबर" },
  "12": { en: "December", hi: "दिसंबर" },
};

/** Short month labels for Sade Sati phase ranges ("Jan–May"). */
export const MONTH_SHORT: Record<string, { en: string; hi: string }> = {
  "01": { en: "Jan", hi: "जन" },
  "02": { en: "Feb", hi: "फ़र" },
  "03": { en: "Mar", hi: "मार्च" },
  "04": { en: "Apr", hi: "अप्रै" },
  "05": { en: "May", hi: "मई" },
  "06": { en: "Jun", hi: "जून" },
  "07": { en: "Jul", hi: "जुल" },
  "08": { en: "Aug", hi: "अग" },
  "09": { en: "Sep", hi: "सित" },
  "10": { en: "Oct", hi: "अक्टू" },
  "11": { en: "Nov", hi: "नव" },
  "12": { en: "Dec", hi: "दिस" },
};

/** §6 — house themes for Do's & Don'ts and the thought-of-the-day. */
export const HOUSE_THEMES: Record<number, { tag: string; do_hint: string; dont_hint: string }> = {
  1: {
    tag: "self",
    do_hint: "begin small personal projects, self-care",
    dont_hint: "overcommitting publicly",
  },
  2: {
    tag: "money_speech",
    do_hint: "gentle speech, sensible budgeting",
    dont_hint: "harsh words, impulse purchases",
  },
  3: {
    tag: "courage",
    do_hint: "start that pending task, call siblings",
    dont_hint: "scattering energy across too many things",
  },
  4: {
    tag: "home",
    do_hint: "tidy the home, family time",
    dont_hint: "rushing property decisions",
  },
  5: {
    tag: "children_creativity",
    do_hint: "creative hobbies, mentoring",
    dont_hint: "speculation and rushed gambles",
  },
  6: {
    tag: "service",
    do_hint: "exercise, steady routine, helping others",
    dont_hint: "confrontations and arguments",
  },
  7: { tag: "partnership", do_hint: "listening, collaboration", dont_hint: "forcing agreements" },
  8: {
    tag: "change_research",
    do_hint: "backing up work, careful research",
    dont_hint: "ignoring small health niggles",
  },
  9: {
    tag: "learning_travel",
    do_hint: "study, plan trips, seek elders' advice",
    dont_hint: "dismissing good counsel",
  },
  10: { tag: "work", do_hint: "pitch ideas, take the lead", dont_hint: "public disputes" },
  11: {
    tag: "gains",
    do_hint: "networking, following up on offers",
    dont_hint: "impulsive lending",
  },
  12: {
    tag: "rest_expense",
    do_hint: "rest, charity, reviewing finances",
    dont_hint: "taking on big new commitments",
  },
};

/** Sign lords' fixed attributes = the per-sign lucky fallback (§9). */
export function signFallbackPlanet(sign: HoroscopeSign): PlanetName {
  return SIGN_LORD[sign];
}

/** §3 house-from-sign helper. */
export function houseFromSign(planetSignIndex: number, signIndex: number): number {
  return ((((planetSignIndex - signIndex) % 12) + 12) % 12) + 1;
}

/**
 * Which planet obstructs `planet` sitting in its favorable `goodHouse`, if any.
 * `positions` maps planet → HOUSE number counted from the reader's sign
 * (not raw signIndex — callers must convert, see score.ts houseMap).
 */
export function vedhaObstructor(
  planet: PlanetName,
  goodHouse: number,
  positions: Map<PlanetName, number>,
): PlanetName | null {
  const obstructingHouse = VEDHA_PAIRS[planet]?.[goodHouse];
  if (!obstructingHouse) return null;
  for (const other of PLANETS) {
    if (other === planet) continue;
    if (other === "Moon" && !MOON_AS_OBSTRUCTOR) continue;
    if (other === "Rahu" || other === "Ketu") continue; // nodes neither cause nor receive vedha
    const exemption = NEVER_OBSTRUCT.some(
      ([a, b]) => (a === planet && b === other) || (a === other && b === planet),
    );
    if (exemption) continue;
    const otherHouse = positions.get(other);
    if (otherHouse === obstructingHouse) return other;
  }
  return null;
}

/** Sign index from slug (0..11). */
export function signIndex(sign: HoroscopeSign): number {
  return HOROSCOPE_SIGNS.indexOf(sign);
}

/** Hindi house ordinals in the oblique form used with "में" (clause fragments). */
export const HOUSE_ORDINAL_HI: Record<number, string> = {
  1: "पहले",
  2: "दूसरे",
  3: "तीसरे",
  4: "चौथे",
  5: "पांचवें",
  6: "छठे",
  7: "सातवें",
  8: "आठवें",
  9: "नौवें",
  10: "दसवें",
  11: "ग्यारहवें",
  12: "बारहवें",
};
