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

export function karanaName(index: number): string {
  // index = floor(elongation / 6), 0..59
  if (index === 0) return "Kimstughna";
  if (index >= 57) return FIXED_KARANAS[index - 57] ?? "Shakuni"; // 57 Shakuni, 58 Chatushpada, 59 Naga
  return MOVABLE_KARANAS[(index - 1) % 7] ?? "Bava";
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
