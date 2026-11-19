/**
 * Ashtakoota (36-guna) marriage matching + Manglik dosha (Epic 1.8, PRD §5.5).
 *
 * Pure functions over two birth inputs. All koota tables follow the classical
 * Ashtakoota system as published in standard Muhurta references; where schools
 * differ (gana cross-scores, yoni friendliness, vashya bhakshya), the chosen
 * variant is documented inline and the whole module is flagged
 * `verified: false` pending Jyotishi review (placeholder register P11 — same
 * policy as the Rahu-Kaal tables).
 */
import { ascendantSidereal } from "./ascendant";
import { type KundliInput, planetaryPositions } from "./kundli";

const SIGNS = [
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

export const KOOTA_ORDER = [
  "varna",
  "vashya",
  "tara",
  "yoni",
  "graha_maitri",
  "gana",
  "bhakoot",
  "nadi",
] as const;
export type KootaName = (typeof KOOTA_ORDER)[number];

export const ASHTAKOOTA_MAX = 36;
/** Classical acceptance threshold for a match (≥ 18 of 36). */
export const ASHTAKOOTA_THRESHOLD = 18;

// ---------------------------------------------------------------------------
// Person profile extracted from a kundli
// ---------------------------------------------------------------------------

export interface MatchProfile {
  moon_sign: string;
  moon_sign_index: number;
  moon_nakshatra: string;
  moon_nakshatra_index: number;
  moon_pada: number;
  moon_lon: number;
  rashi_lord: string;
  varna: "Brahmin" | "Kshatriya" | "Vaishya" | "Shudra";
  vashya: VashyaGroup;
  yoni: YoniAnimal;
  gana: "Deva" | "Manushya" | "Rakshasa";
  nadi: "Adi" | "Madhya" | "Antya";
}

// ---------------------------------------------------------------------------
// Table 1 — Varna (1 point): sign element → varna; boy's varna ≥ girl's → 1.
// Water = Brahmin, Fire = Kshatriya, Earth = Vaishya, Air = Shudra.
// ---------------------------------------------------------------------------

const VARNA_RANK: Record<MatchProfile["varna"], number> = {
  Brahmin: 4,
  Kshatriya: 3,
  Vaishya: 2,
  Shudra: 1,
};

function varnaOf(signIndex: number): MatchProfile["varna"] {
  // element by sign triad: 0 fire, 1 earth, 2 air, 3 water
  const element = signIndex % 4;
  if (element === 3) return "Brahmin"; // Cancer, Scorpio, Pisces
  if (element === 0) return "Kshatriya"; // Aries, Leo, Sagittarius
  if (element === 1) return "Vaishya"; // Taurus, Virgo, Capricorn
  return "Shudra"; // Gemini, Libra, Aquarius
}

// ---------------------------------------------------------------------------
// Table 2 — Vashya (2 points). Half-sign table (we hold the exact Moon
// longitude). Groups: manava (human), chatushpada (quadruped), jalachara
// (water), vanachara (wild), keeta (insect).
// Scoring: same group → 2; food (bhakshya) relation → 0; otherwise → 1.
// Bhakshya pairs (chosen variant, documented): chatushpada eats manava;
// manava eats jalachara, vanachara, keeta; jalachara eats keeta.
// ---------------------------------------------------------------------------

export type VashyaGroup = "manava" | "chatushpada" | "jalachara" | "vanachara" | "keeta";

function vashyaOf(signIndex: number, lonInSign: number): VashyaGroup {
  const firstHalf = lonInSign < 15;
  switch (signIndex) {
    case 0: // Aries: 1st half manava, 2nd half chatushpada
      return firstHalf ? "manava" : "chatushpada";
    case 1: // Taurus: 1st half chatushpada, 2nd half vanachara
      return firstHalf ? "chatushpada" : "vanachara";
    case 2: // Gemini
    case 5: // Virgo
    case 6: // Libra
    case 10: // Aquarius
      return "manava";
    case 3: // Cancer
      return "jalachara";
    case 4: // Leo: 1st half manava, 2nd half chatushpada
      return firstHalf ? "manava" : "chatushpada";
    case 7: // Scorpio: 1st half jalachara, 2nd half keeta
      return firstHalf ? "jalachara" : "keeta";
    case 8: // Sagittarius: 1st half manava, 2nd half chatushpada
      return firstHalf ? "manava" : "chatushpada";
    case 9: // Capricorn: 1st half chatushpada, 2nd half manava
      return firstHalf ? "chatushpada" : "manava";
    case 11: // Pisces
      return "jalachara";
    default:
      return "manava";
  }
}

const VASHYA_FOOD: Record<VashyaGroup, VashyaGroup[]> = {
  chatushpada: ["manava"],
  manava: ["jalachara", "vanachara", "keeta"],
  jalachara: ["keeta"],
  vanachara: [],
  keeta: [],
};

// ---------------------------------------------------------------------------
// Table 3 — Tara (3 points): count inclusive from A's nakshatra to B's;
// count mod 9 → tara class. Auspicious (1.5 each direction): Janma(1),
// Sampat(2), Kshema(4), Sadhaka(6), Mitra(8), Ati-mitra(9). Inauspicious (0):
// Vipat(3), Pratyari(5), Vadha(7).
// ---------------------------------------------------------------------------

const TARA_NAMES = [
  "Janma",
  "Sampat",
  "Vipat",
  "Kshema",
  "Pratyari",
  "Sadhaka",
  "Vadha",
  "Mitra",
  "Ati-mitra",
] as const;
const TARA_GOOD = new Set([1, 2, 4, 6, 8, 9]);

function taraCount(fromIdx: number, toIdx: number): number {
  return ((toIdx - fromIdx + 27) % 27) + 1;
}

// ---------------------------------------------------------------------------
// Table 4 — Yoni (4 points): nakshatra → animal; 13 paired animals + the
// unpaired mongoose. Scoring (chosen variant, documented): same animal → 4;
// enemy animal → 0; otherwise → 2.
// ---------------------------------------------------------------------------

export type YoniAnimal =
  | "Ashwa"
  | "Gaja"
  | "Mesha"
  | "Sarpa"
  | "Shwan"
  | "Marjara"
  | "Mushaka"
  | "Gau"
  | "Mahisha"
  | "Vyaghra"
  | "Mriga"
  | "Vanara"
  | "Nakula"
  | "Simha";

const YONI_ANIMALS: YoniAnimal[] = [
  "Ashwa", // 0 Ashwini
  "Gaja", // 1 Bharani
  "Mesha", // 2 Krittika
  "Sarpa", // 3 Rohini
  "Sarpa", // 4 Mrigashira
  "Shwan", // 5 Ardra
  "Marjara", // 6 Punarvasu
  "Mesha", // 7 Pushya
  "Marjara", // 8 Ashlesha
  "Mushaka", // 9 Magha
  "Mushaka", // 10 Purva Phalguni
  "Gau", // 11 Uttara Phalguni
  "Mahisha", // 12 Hasta
  "Vyaghra", // 13 Chitra
  "Mahisha", // 14 Swati
  "Vyaghra", // 15 Vishakha
  "Mriga", // 16 Anuradha
  "Mriga", // 17 Jyeshtha
  "Shwan", // 18 Mula
  "Vanara", // 19 Purva Ashadha
  "Nakula", // 20 Uttara Ashadha (the unpaired yoni)
  "Vanara", // 21 Shravana
  "Simha", // 22 Dhanishta
  "Ashwa", // 23 Shatabhisha
  "Simha", // 24 Purva Bhadrapada
  "Gau", // 25 Uttara Bhadrapada
  "Gaja", // 26 Revati
];

const YONI_ENEMY: Partial<Record<YoniAnimal, YoniAnimal>> = {
  Ashwa: "Mahisha",
  Mahisha: "Ashwa",
  Gaja: "Simha",
  Simha: "Gaja",
  Mesha: "Vanara",
  Vanara: "Mesha",
  Shwan: "Mriga",
  Mriga: "Shwan",
  Sarpa: "Nakula",
  Nakula: "Sarpa",
  Marjara: "Mushaka",
  Mushaka: "Marjara",
  Gau: "Vyaghra",
  Vyaghra: "Gau",
};

// ---------------------------------------------------------------------------
// Table 5 — Graha Maitri (5 points): Moon-sign lords + classical planetary
// friendship. Same lord → 5; friend-friend → 4; friend-neutral → 3;
// neutral-neutral → 2; friend-enemy → 1; neutral-enemy → 0.5; enemy-enemy → 0.
// ---------------------------------------------------------------------------

const RASHI_LORDS = [
  "Mars",
  "Venus",
  "Mercury",
  "Moon",
  "Sun",
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Saturn",
  "Jupiter",
] as const;

type Lord = "Sun" | "Moon" | "Mars" | "Mercury" | "Jupiter" | "Venus" | "Saturn";

const FRIENDS: Record<Lord, Lord[]> = {
  Sun: ["Moon", "Mars", "Jupiter"],
  Moon: ["Sun", "Mercury"],
  Mars: ["Sun", "Moon", "Jupiter"],
  Mercury: ["Sun", "Venus"],
  Jupiter: ["Sun", "Moon", "Mars"],
  Venus: ["Mercury", "Saturn"],
  Saturn: ["Mercury", "Venus"],
};
const ENEMIES: Record<Lord, Lord[]> = {
  Sun: ["Venus", "Saturn"],
  Moon: [],
  Mars: ["Mercury"],
  Mercury: ["Moon"],
  Jupiter: ["Mercury", "Venus"],
  Venus: ["Sun", "Moon"],
  Saturn: ["Sun", "Moon", "Mars"],
};

function maitriRelation(a: Lord, b: Lord): "same" | "friend" | "neutral" | "enemy" {
  if (a === b) return "same";
  if (FRIENDS[a].includes(b)) return "friend";
  if (ENEMIES[a].includes(b)) return "enemy";
  return "neutral";
}

function maitriPoints(lordA: Lord, lordB: Lord): number {
  if (lordA === lordB) return 5;
  const relA = maitriRelation(lordA, lordB); // how A regards B
  const relB = maitriRelation(lordB, lordA); // how B regards A
  // Classical convention: the worse of the two directions governs the score.
  if (relA === "friend" && relB === "friend") return 4;
  if (relA === "enemy" && relB === "enemy") return 0;
  if (relA === "enemy" || relB === "enemy") {
    // friend–enemy → 1; neutral–enemy → 0.5
    return relA === "neutral" || relB === "neutral" ? 0.5 : 1;
  }
  if (relA === "friend" || relB === "friend") return 3; // friend–neutral mix
  return 2; // neutral–neutral
}

// ---------------------------------------------------------------------------
// Table 6 — Gana (6 points): nakshatra temperament. Classical cross-scores:
// same gana → 6; deva–manushya → 5; deva–rakshasa → 1; manushya–rakshasa → 0.
// ---------------------------------------------------------------------------

const GANA_BY_NAKSHATRA: MatchProfile["gana"][] = [
  "Deva", // 0 Ashwini
  "Manushya", // 1 Bharani
  "Rakshasa", // 2 Krittika
  "Manushya", // 3 Rohini
  "Deva", // 4 Mrigashira
  "Manushya", // 5 Ardra
  "Deva", // 6 Punarvasu
  "Deva", // 7 Pushya
  "Rakshasa", // 8 Ashlesha
  "Rakshasa", // 9 Magha
  "Manushya", // 10 Purva Phalguni
  "Manushya", // 11 Uttara Phalguni
  "Deva", // 12 Hasta
  "Rakshasa", // 13 Chitra
  "Deva", // 14 Swati
  "Rakshasa", // 15 Vishakha
  "Deva", // 16 Anuradha
  "Rakshasa", // 17 Jyeshtha
  "Rakshasa", // 18 Mula
  "Manushya", // 19 Purva Ashadha
  "Manushya", // 20 Uttara Ashadha
  "Deva", // 21 Shravana
  "Rakshasa", // 22 Dhanishta
  "Rakshasa", // 23 Shatabhisha
  "Manushya", // 24 Purva Bhadrapada
  "Manushya", // 25 Uttara Bhadrapada
  "Deva", // 26 Revati
];

function ganaPoints(a: MatchProfile["gana"], b: MatchProfile["gana"]): number {
  if (a === b) return 6;
  const cross = [a, b];
  if (cross.includes("Rakshasa")) return cross.includes("Deva") ? 1 : 0;
  return 5; // deva ↔ manushya
}

// ---------------------------------------------------------------------------
// Table 7 — Bhakoot (7 points): relative Moon-sign positions. Dosha pairs:
// 2/12, 5/9, 6/8 → 0; all others → 7. Cancellation (documented): a dosha
// pair is nullified when the two sign lords are mutual friends.
// ---------------------------------------------------------------------------

const BHAKOOT_DOSHA = new Set(["2/12", "5/9", "6/8"]);

// ---------------------------------------------------------------------------
// Table 8 — Nadi (8 points): nakshatra nadi. Same nadi → 0 (Nadi dosha);
// different → 8.
// ---------------------------------------------------------------------------

const NADI_BY_NAKSHATRA: MatchProfile["nadi"][] = [
  "Adi", // 0 Ashwini
  "Madhya", // 1 Bharani
  "Antya", // 2 Krittika
  "Adi", // 3 Rohini
  "Madhya", // 4 Mrigashira
  "Adi", // 5 Ardra
  "Adi", // 6 Punarvasu
  "Madhya", // 7 Pushya
  "Antya", // 8 Ashlesha
  "Antya", // 9 Magha
  "Madhya", // 10 Purva Phalguni
  "Adi", // 11 Uttara Phalguni
  "Adi", // 12 Hasta
  "Madhya", // 13 Chitra
  "Antya", // 14 Swati
  "Antya", // 15 Vishakha
  "Madhya", // 16 Anuradha
  "Adi", // 17 Jyeshtha
  "Adi", // 18 Mula
  "Madhya", // 19 Purva Ashadha
  "Antya", // 20 Uttara Ashadha
  "Antya", // 21 Shravana
  "Madhya", // 22 Dhanishta
  "Adi", // 23 Shatabhisha
  "Antya", // 24 Purva Bhadrapada
  "Madhya", // 25 Uttara Bhadrapada
  "Antya", // 26 Revati
];

// ---------------------------------------------------------------------------
// Profile + koota computation
// ---------------------------------------------------------------------------

export function matchProfile(input: KundliInput): MatchProfile {
  const grahas = planetaryPositions(input);
  const moon = grahas.find((p) => p.planet === "Moon");
  if (!moon) throw new Error("Moon position unavailable");
  const signIdx = moon.signIndex;
  const lonInSign = ((moon.lon % 30) + 30) % 30;
  return {
    moon_sign: moon.sign,
    moon_sign_index: signIdx,
    moon_nakshatra: moon.nakshatra,
    moon_nakshatra_index: moon.nakshatraIndex,
    moon_pada: moon.pada,
    moon_lon: moon.lon,
    rashi_lord: RASHI_LORDS[signIdx] ?? "Mars",
    varna: varnaOf(signIdx),
    vashya: vashyaOf(signIdx, lonInSign),
    yoni: YONI_ANIMALS[moon.nakshatraIndex] ?? "Ashwa",
    gana: GANA_BY_NAKSHATRA[moon.nakshatraIndex] ?? "Manushya",
    nadi: NADI_BY_NAKSHATRA[moon.nakshatraIndex] ?? "Adi",
  };
}

export interface KootaResult {
  koota: KootaName;
  points: number;
  max: number;
  detail: string;
  dosha: boolean;
}

export interface AshtakootaResult {
  boy: MatchProfile;
  girl: MatchProfile;
  kootas: KootaResult[];
  total: number;
  max: number;
  threshold: number;
  acceptable: boolean;
  verified: false;
}

export function ashtakoota(boyInput: KundliInput, girlInput: KundliInput): AshtakootaResult {
  const boy = matchProfile(boyInput);
  const girl = matchProfile(girlInput);
  const kootas: KootaResult[] = [];

  // 1 — Varna: boy's varna rank must be ≥ girl's.
  const varnaOk = VARNA_RANK[boy.varna] >= VARNA_RANK[girl.varna];
  kootas.push({
    koota: "varna",
    points: varnaOk ? 1 : 0,
    max: 1,
    dosha: !varnaOk,
    detail: `Boy ${boy.varna} (${boy.moon_sign}) vs girl ${girl.varna} (${girl.moon_sign}).`,
  });

  // 2 — Vashya: same group 2; food relation 0; otherwise 1.
  const foodEither =
    VASHYA_FOOD[boy.vashya].includes(girl.vashya) || VASHYA_FOOD[girl.vashya].includes(boy.vashya);
  const vashyaPoints = boy.vashya === girl.vashya ? 2 : foodEither ? 0 : 1;
  kootas.push({
    koota: "vashya",
    points: vashyaPoints,
    max: 2,
    dosha: vashyaPoints === 0,
    detail: `Boy ${boy.vashya} vs girl ${girl.vashya}${foodEither && boy.vashya !== girl.vashya ? " (food relation)" : ""}.`,
  });

  // 3 — Tara: auspicious tara in each direction scores 1.5.
  const taraBoyToGirl = taraCount(boy.moon_nakshatra_index, girl.moon_nakshatra_index);
  const taraGirlToBoy = taraCount(girl.moon_nakshatra_index, boy.moon_nakshatra_index);
  const taraNumB2G = (((taraBoyToGirl - 1) % 9) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  const taraNumG2B = (((taraGirlToBoy - 1) % 9) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  const taraB2GGood = TARA_GOOD.has(taraNumB2G);
  const taraG2BGood = TARA_GOOD.has(taraNumG2B);
  kootas.push({
    koota: "tara",
    points: (taraB2GGood ? 1.5 : 0) + (taraG2BGood ? 1.5 : 0),
    max: 3,
    dosha: !taraB2GGood || !taraG2BGood,
    detail: `Boy→girl ${TARA_NAMES[taraNumB2G - 1] ?? "Janma"} (${taraBoyToGirl}), girl→boy ${TARA_NAMES[taraNumG2B - 1] ?? "Janma"} (${taraGirlToBoy}).`,
  });

  // 4 — Yoni: same animal 4; enemy 0; otherwise 2.
  const yoniEnemy = YONI_ENEMY[boy.yoni] === girl.yoni || YONI_ENEMY[girl.yoni] === boy.yoni;
  const yoniPoints = boy.yoni === girl.yoni ? 4 : yoniEnemy ? 0 : 2;
  kootas.push({
    koota: "yoni",
    points: yoniPoints,
    max: 4,
    dosha: yoniPoints === 0,
    detail: `Boy ${boy.yoni} vs girl ${girl.yoni}${yoniEnemy && boy.yoni !== girl.yoni ? " (enemy yoni)" : ""}.`,
  });

  // 5 — Graha Maitri: Moon-sign lords' friendship.
  const maitri = maitriPoints(boy.rashi_lord as Lord, girl.rashi_lord as Lord);
  kootas.push({
    koota: "graha_maitri",
    points: maitri,
    max: 5,
    dosha: maitri <= 1,
    detail: `Sign lords ${boy.rashi_lord} (${boy.moon_sign}) and ${girl.rashi_lord} (${girl.moon_sign}).`,
  });

  // 6 — Gana: temperament compatibility.
  const gana = ganaPoints(boy.gana, girl.gana);
  kootas.push({
    koota: "gana",
    points: gana,
    max: 6,
    dosha: gana <= 1,
    detail: `Boy ${boy.gana} (${boy.moon_nakshatra}) vs girl ${girl.gana} (${girl.moon_nakshatra}).`,
  });

  // 7 — Bhakoot: relative sign positions; dosha pairs 2/12, 5/9, 6/8 → 0,
  // cancelled when the sign lords are mutual friends.
  const posB2G = ((girl.moon_sign_index - boy.moon_sign_index + 12) % 12) + 1;
  const posG2B = ((boy.moon_sign_index - girl.moon_sign_index + 12) % 12) + 1;
  const pairKey = `${Math.min(posB2G, posG2B)}/${Math.max(posB2G, posG2B)}`;
  const bhakootDosha = BHAKOOT_DOSHA.has(pairKey);
  const lordsMutualFriends =
    boy.rashi_lord === girl.rashi_lord ||
    (FRIENDS[boy.rashi_lord as Lord].includes(girl.rashi_lord as Lord) &&
      FRIENDS[girl.rashi_lord as Lord].includes(boy.rashi_lord as Lord));
  const bhakootPoints = bhakootDosha && !lordsMutualFriends ? 0 : 7;
  kootas.push({
    koota: "bhakoot",
    points: bhakootPoints,
    max: 7,
    dosha: bhakootPoints === 0,
    detail: bhakootDosha
      ? `Signs ${boy.moon_sign}→${girl.moon_sign} form ${pairKey} bhakoot dosha${bhakootPoints === 7 ? " cancelled (lords are mutual friends)" : ""}.`
      : `Signs ${boy.moon_sign}→${girl.moon_sign}: no bhakoot dosha.`,
  });

  // 8 — Nadi: same nadi is the most severe dosha.
  const nadiPoints = boy.nadi === girl.nadi ? 0 : 8;
  kootas.push({
    koota: "nadi",
    points: nadiPoints,
    max: 8,
    dosha: nadiPoints === 0,
    detail: `Boy ${boy.nadi} (${boy.moon_nakshatra}) vs girl ${girl.nadi} (${girl.moon_nakshatra})${nadiPoints === 0 ? " — Nadi dosha" : ""}.`,
  });

  const total = kootas.reduce((sum, k) => sum + k.points, 0);
  return {
    boy,
    girl,
    kootas,
    total: Math.round(total * 10) / 10,
    max: ASHTAKOOTA_MAX,
    threshold: ASHTAKOOTA_THRESHOLD,
    acceptable: total >= ASHTAKOOTA_THRESHOLD,
    verified: false,
  };
}

// ---------------------------------------------------------------------------
// Manglik (Mars dosha): Mars in houses 1, 2, 4, 7, 8, 12 counted from Lagna,
// Moon AND Venus (classical). Cancellations (documented variant): Mars in own
// sign (Aries, Scorpio) or exalted (Capricorn) nullifies the dosha.
// ---------------------------------------------------------------------------

const MANGLIK_HOUSES = new Set([1, 2, 4, 7, 8, 12]);

export interface ManglikResult {
  is_manglik: boolean;
  from_lagna: boolean;
  from_moon: boolean;
  from_venus: boolean;
  mars_houses: { lagna: number; moon: number; venus: number };
  cancelled: boolean;
  cancellation_reason: string | null;
  detail: string;
  verified: false;
}

/** Whole-sign house of a planet's sign counted from a reference sign (1..12). */
function houseFrom(refSignIndex: number, targetSignIndex: number): number {
  return ((targetSignIndex - refSignIndex + 12) % 12) + 1;
}

export function manglik(input: KundliInput): ManglikResult {
  const grahas = planetaryPositions(input);
  const mars = grahas.find((p) => p.planet === "Mars");
  const venus = grahas.find((p) => p.planet === "Venus");
  if (!mars || !venus) throw new Error("Mars/Venus position unavailable");
  const asc = lagnaFor(input);
  const marsSign = mars.signIndex;

  const houseFromLagna = houseFrom(asc, marsSign);
  const houseFromMoon = houseFrom(
    grahas.find((p) => p.planet === "Moon")?.signIndex ?? 0,
    marsSign,
  );
  const houseFromVenus = houseFrom(venus.signIndex, marsSign);

  const fromLagna = MANGLIK_HOUSES.has(houseFromLagna);
  const fromMoon = MANGLIK_HOUSES.has(houseFromMoon);
  const fromVenus = MANGLIK_HOUSES.has(houseFromVenus);

  // Cancellation: Mars in own sign (Aries/Scorpio) or exaltation (Capricorn).
  const cancelled = marsSign === 0 || marsSign === 7 || marsSign === 9;
  const cancellationReason = cancelled
    ? `Mars in ${SIGNS[marsSign] ?? "Aries"} (own sign / exaltation) — classical cancellation.`
    : null;

  const isManglik = !cancelled && (fromLagna || fromMoon || fromVenus);
  return {
    is_manglik: isManglik,
    from_lagna: !cancelled && fromLagna,
    from_moon: !cancelled && fromMoon,
    from_venus: !cancelled && fromVenus,
    mars_houses: { lagna: houseFromLagna, moon: houseFromMoon, venus: houseFromVenus },
    cancelled,
    cancellation_reason: cancellationReason,
    detail: `Mars in house ${houseFromLagna} from Lagna, ${houseFromMoon} from Moon, ${houseFromVenus} from Venus.`,
    verified: false,
  };
}

// Lagna sign index without importing the full lagna() shape here.
function lagnaFor(input: KundliInput): number {
  const lon = ascendantSidereal(input.datetime, input.latitude, input.longitude);
  return Math.floor((((lon % 360) + 360) % 360) / 30);
}
