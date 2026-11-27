/**
 * Sanskrit name tables for Panchang limbs (Epic 1.2).
 * Traditional spellings; Hindi (Devanagari) equivalents added for /hi/ (PRD §9).
 */

export const TITHIS = [
  "Pratipada",
  "Dwitiya",
  "Tritiya",
  "Chaturthi",
  "Panchami",
  "Shashthi",
  "Saptami",
  "Ashtami",
  "Navami",
  "Dashami",
  "Ekadashi",
  "Dwadashi",
  "Trayodashi",
  "Chaturdashi",
  "Purnima",
  "Pratipada",
  "Dwitiya",
  "Tritiya",
  "Chaturthi",
  "Panchami",
  "Shashthi",
  "Saptami",
  "Ashtami",
  "Navami",
  "Dashami",
  "Ekadashi",
  "Dwadashi",
  "Trayodashi",
  "Chaturdashi",
  "Amavasya",
];

/** Karana index 0..59 → name (Movable karanas repeat; fixed karanas at ends). */
const MOVABLE_KARANAS = ["Bava", "Balava", "Kaulava", "Taitila", "Gara", "Vanija", "Vishti"];
const FIXED_KARANAS = ["Shakuni", "Chatushpada", "Naga", "Kimstughna"];

/** S24 — Hindi tithi names (index-aligned with TITHIS). */
export const TITHIS_HI = [
  "प्रतिपदा",
  "द्वितीया",
  "तृतीया",
  "चतुर्थी",
  "पंचमी",
  "षष्ठी",
  "सप्तमी",
  "अष्टमी",
  "नवमी",
  "दशमी",
  "एकादशी",
  "द्वादशी",
  "त्रयोदशी",
  "चतुर्दशी",
  "पूर्णिमा",
  "प्रतिपदा",
  "द्वितीया",
  "तृतीया",
  "चतुर्थी",
  "पंचमी",
  "षष्ठी",
  "सप्तमी",
  "अष्टमी",
  "नवमी",
  "दशमी",
  "एकादशी",
  "द्वादशी",
  "त्रयोदशी",
  "चतुर्दशी",
  "अमावस्या",
];

/** S24 — Hindi karana names, index-aligned with the EN tables above. */
const MOVABLE_KARANAS_HI = ["बव", "बालव", "कौलव", "तैतिल", "गर", "वणिज", "विष्टि"];
const FIXED_KARANAS_HI = ["शकुनि", "चतुष्पद", "नाग", "किंस्तुघ्न"];

export function karanaName(index: number): string {
  // index = floor(elongation / 6), 0..59
  if (index === 0) return "Kimstughna";
  if (index >= 57) return FIXED_KARANAS[index - 57] ?? "Shakuni"; // 57 Shakuni, 58 Chatushpada, 59 Naga
  return MOVABLE_KARANAS[(index - 1) % 7] ?? "Bava";
}

export function karanaNameHi(index: number): string {
  if (index === 0) return "किंस्तुघ्न";
  if (index >= 57) return FIXED_KARANAS_HI[index - 57] ?? "शकुनि";
  return MOVABLE_KARANAS_HI[(index - 1) % 7] ?? "बव";
}

export const NAKSHATRAS = [
  "Ashwini",
  "Bharani",
  "Krittika",
  "Rohini",
  "Mrigashira",
  "Ardra",
  "Punarvasu",
  "Pushya",
  "Ashlesha",
  "Magha",
  "Purva Phalguni",
  "Uttara Phalguni",
  "Hasta",
  "Chitra",
  "Swati",
  "Vishakha",
  "Anuradha",
  "Jyeshtha",
  "Mula",
  "Purva Ashadha",
  "Uttara Ashadha",
  "Shravana",
  "Dhanishta",
  "Shatabhisha",
  "Purva Bhadrapada",
  "Uttara Bhadrapada",
  "Revati",
];

export const NAKSHATRAS_HI = [
  "अश्विनी",
  "भरणी",
  "कृत्तिका",
  "रोहिणी",
  "मृगशिरा",
  "आर्द्रा",
  "पुनर्वसु",
  "पुष्य",
  "आश्लेषा",
  "मघा",
  "पूर्व फाल्गुनी",
  "उत्तर फाल्गुनी",
  "हस्त",
  "चित्रा",
  "स्वाती",
  "विशाखा",
  "अनुराधा",
  "ज्येष्ठा",
  "मूल",
  "पूर्वाषाढ़ा",
  "उत्तराषाढ़ा",
  "श्रवण",
  "धनिष्ठा",
  "शतभिषा",
  "पूर्व भाद्रपद",
  "उत्तर भाद्रपद",
  "रेवती",
];

export const YOGAS = [
  "Vishkambha",
  "Priti",
  "Ayushman",
  "Saubhagya",
  "Shobhana",
  "Atiganda",
  "Sukarma",
  "Dhriti",
  "Shula",
  "Ganda",
  "Vriddhi",
  "Dhruva",
  "Vyaghata",
  "Harshana",
  "Vajra",
  "Siddhi",
  "Vyatipata",
  "Variyana",
  "Parigha",
  "Shiva",
  "Siddha",
  "Sadhya",
  "Shubha",
  "Shukla",
  "Brahma",
  "Indra",
  "Vaidhriti",
];

/** S24 — Hindi yoga names (index-aligned with YOGAS). */
export const YOGAS_HI = [
  "विष्कम्भ",
  "प्रीति",
  "आयुष्मान्",
  "सौभाग्य",
  "शोभन",
  "अतिगंड",
  "सुकर्मा",
  "धृति",
  "शूल",
  "गंड",
  "वृद्धि",
  "ध्रुव",
  "व्याघात",
  "हर्षण",
  "वज्र",
  "सिद्धि",
  "व्यतिपात",
  "वरीयान्",
  "परिघ",
  "शिव",
  "सिद्ध",
  "साध्य",
  "शुभ",
  "शुक्ल",
  "ब्रह्म",
  "इन्द्र",
  "वैधृति",
];

/** Vedic weekday — index 0..6 (Sunday..Saturday). */
export const VAARS = [
  "Ravivara",
  "Somavara",
  "Mangalavara",
  "Budhavara",
  "Guruvara",
  "Shukravara",
  "Shanivara",
];
export const VAARS_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];

/**
 * Inauspicious-day-segment tables (proportional method).
 *
 * SOURCE: widely-published traditional tables (as shown on major panchang
 * sites). PENDING Jyotishi VERIFICATION before public launch — placeholder
 * register P11. Segment = index of 1/8th of the daytime span (sunrise→sunset),
 * 1-indexed.
 */
const RAHU_KAAL_PART: Record<number, number> = { 0: 8, 1: 2, 2: 7, 3: 5, 4: 6, 5: 4, 6: 3 };
const YAMAGANDA_PART: Record<number, number> = { 0: 5, 1: 4, 2: 3, 3: 8, 4: 2, 5: 7, 6: 6 };
const GULIKA_PART: Record<number, number> = { 0: 7, 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1 };

export function daySegmentTables(vaarIndex: number): {
  rahu: number;
  yamaganda: number;
  gulika: number;
} {
  return {
    rahu: RAHU_KAAL_PART[vaarIndex] ?? 8,
    yamaganda: YAMAGANDA_PART[vaarIndex] ?? 5,
    gulika: GULIKA_PART[vaarIndex] ?? 7,
  };
}

/** Lunar (Hindu) months — Amanta & Purnimanta share the name cycle (Epic 1.7). */
export const LUNAR_MONTHS = [
  "Chaitra",
  "Vaisakha",
  "Jyeshtha",
  "Ashadha",
  "Shravana",
  "Bhadrapada",
  "Ashwin",
  "Kartika",
  "Margashirsha",
  "Pausha",
  "Magha",
  "Phalguna",
];

export const LUNAR_MONTHS_HI = [
  "चैत्र",
  "वैशाख",
  "ज्येष्ठ",
  "आषाढ़",
  "श्रावण",
  "भाद्रपद",
  "आश्विन",
  "कार्तिक",
  "मार्गशीर्ष",
  "पौष",
  "माघ",
  "फाल्गुन",
];

export const PAKSHA_NAMES = ["Shukla", "Krishna"] as const;
export const PAKSHA_NAMES_HI = ["शुक्ल", "कृष्ण"] as const;

/* S24 — bilingual sign (rashi) + graha tables for calculator/kundli
   localization (?lang=hi). EN sign spellings match SIGNS_TROPICAL /
   SIGNS_SIDEREAL in calculators.ts / kundli.ts so tables key cleanly. */
export const SIGNS = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
] as const;
export const SIGNS_HI = [
  "मेष",
  "वृषभ",
  "मिथुन",
  "कर्क",
  "सिंह",
  "कन्या",
  "तुला",
  "वृश्चिक",
  "धनु",
  "मकर",
  "कुम्भ",
  "मीन",
] as const;

/** The 9 grahas + outer planets where engines emit them; lookup by EN name. */
export const PLANETS_HI: Record<string, string> = {
  Sun: "सूर्य",
  Moon: "चंद्र",
  Mars: "मंगल",
  Mercury: "बुध",
  Jupiter: "गुरु",
  Venus: "शुक्र",
  Saturn: "शनि",
  Rahu: "राहु",
  Ketu: "केतु",
  Uranus: "अरुण",
  Neptune: "वरुण",
  Pluto: "यम",
};

/** S24 — Hindi names for the five named day segments. */
export const SEGMENTS_HI: Record<string, string> = {
  "Rahu Kaal": "राहु काल",
  Yamaganda: "यमगंड",
  Gulika: "गुलिका",
  "Abhijit Muhurat": "अभिजीत मुहूर्त",
  "Brahma Muhurta": "ब्रह्म मुहूर्त",
};
