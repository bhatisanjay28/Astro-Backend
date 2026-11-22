/**
 * Zodiac Sign Compatibility engine tests — Epic ZC / S-ZC-2 (QA-mindset).
 *
 * The canonical scoring model is the §2 formula in
 * _bmad-output/zodiac-compatibility/research/pair-matrix.md; D-ZC8 documents
 * the nine §4 research-table arithmetic slips the formula corrects (notably
 * Capricorn–Aquarius 52 → 55, Challenging → Mixed). Distribution/extremes
 * asserted here are FORMULA-derived, not table-copied.
 *
 * Content-structure tests (final describe block) exercise the editorial
 * pipeline contract: they stay red until the Epic ZC content lands in
 * src/data/sign-compatibility/pairs.json — that is intentional (loud, never
 * silently skipped).
 */
import { describe, expect, it } from "bun:test";
import {
  allCanonicalPairs,
  aspectFor,
  canonicalPairSlug,
  isZodiacSign,
  PAIR_CONTENT_COUNT,
  pairContent,
  signCompatibilityFacts,
  signCompatibilityScores,
  signPairResult,
  UnknownSignError,
  ZODIAC_SIGNS,
  type ZodiacSign,
} from "../src/engine";

const SIGNS = ZODIAC_SIGNS as readonly ZodiacSign[];

/** All 144 ordered (sign1, sign2) lookups, in wheel order. */
function* orderedPairs(): Generator<[ZodiacSign, ZodiacSign]> {
  for (const a of SIGNS) for (const b of SIGNS) yield [a, b];
}

describe("sign-compatibility engine — geometry", () => {
  it("classifies aspects by wheel distance d = min(diff, 12 − diff)", () => {
    expect(aspectFor("aries", "aries")).toBe("conjunction");
    expect(aspectFor("aries", "taurus")).toBe("semisextile");
    expect(aspectFor("aries", "gemini")).toBe("sextile");
    expect(aspectFor("aries", "cancer")).toBe("square");
    expect(aspectFor("aries", "leo")).toBe("trine");
    expect(aspectFor("aries", "virgo")).toBe("quincunx");
    expect(aspectFor("aries", "libra")).toBe("opposition");
    // wrap-around: pisces (11) → aries (0) is also semi-sextile
    expect(aspectFor("pisces", "aries")).toBe("semisextile");
    expect(aspectFor("scorpio", "pisces")).toBe("trine");
    expect(aspectFor("virgo", "libra")).toBe("semisextile");
  });

  it("canonicalises pair slugs symmetrically and yields exactly 78 unique pairs", () => {
    expect(canonicalPairSlug("leo", "aries")).toBe("aries-leo");
    expect(canonicalPairSlug("aries", "leo")).toBe("aries-leo");
    const slugs = allCanonicalPairs();
    expect(slugs.length).toBe(78);
    expect(new Set(slugs).size).toBe(78);
    for (const slug of slugs) {
      const [a, b] = slug.split("-");
      expect(isZodiacSign(a)).toBe(true);
      expect(isZodiacSign(b)).toBe(true);
    }
  });
});

describe("sign-compatibility engine — formula (pair-matrix §2)", () => {
  it("scores all 12 same-sign pairs exactly 80 (Strong)", () => {
    for (const sign of SIGNS) {
      const result = signCompatibilityScores(sign, sign);
      expect(result.score).toBe(80);
      expect(result.band).toBe("Strong");
    }
  });

  it("scores all six opposition pairs exactly 59 (Mixed)", () => {
    for (const [a, b] of [
      ["aries", "libra"],
      ["taurus", "scorpio"],
      ["gemini", "sagittarius"],
      ["cancer", "capricorn"],
      ["leo", "aquarius"],
      ["virgo", "pisces"],
    ] as Array<[ZodiacSign, ZodiacSign]>) {
      const result = signCompatibilityScores(a, b);
      expect(result.score).toBe(59);
      expect(result.band).toBe("Mixed");
    }
  });

  it("reproduces the pair-matrix §4 spot vectors (D-ZC8)", () => {
    // trine 88 + Sun exalted in Aries (+3)
    expect(signCompatibilityScores("aries", "leo").score).toBe(91);
    // square 45 − contrary fire–water −3 − Mars fall in Cancer −4
    expect(signCompatibilityScores("aries", "cancer").score).toBe(38);
    // opposition 62 + complementary +3 − mutual detriment clamped to −6
    expect(signCompatibilityScores("aries", "libra").score).toBe(59);
    // square 45 − contrary air–earth −3 + Mercury exalted in Virgo +3 + shared Mercury +2
    expect(signCompatibilityScores("gemini", "virgo").score).toBe(47);
    // quincunx 48 − contrary earth–air −3 + shared Venus +2
    expect(signCompatibilityScores("taurus", "libra").score).toBe(47);
    // trine 88 − mutual-fall dignity clamped to −6 → 82 (capped, band retained)
    expect(signCompatibilityScores("cancer", "scorpio").score).toBe(82);
    // sextile 78 + Saturn exalted in Libra +3 → 91
    expect(signCompatibilityScores("libra", "aquarius").score).toBe(91);
    // trine 88 + Jupiter exalted in Cancer +3 → 91
    expect(signCompatibilityScores("cancer", "pisces").score).toBe(91);
    // semisextile 54 − contrary earth–air −3 + shared traditional Saturn +1 → 52
    expect(signCompatibilityScores("capricorn", "aquarius").score).toBe(52);
    expect(signCompatibilityScores("capricorn", "aquarius").band).toBe("Challenging");
    // THE one §4 table slip (D-ZC8): square 45 − contrary earth–air −3 → 42, table said 45
    expect(signCompatibilityScores("taurus", "aquarius").score).toBe(42);
    expect(signCompatibilityScores("taurus", "aquarius").band).toBe("Challenging");
  });

  it("keeps every score inside the honest 35–95 range across all 144 ordered lookups", () => {
    for (const [a, b] of orderedPairs()) {
      const { score, categories } = signCompatibilityScores(a, b);
      expect(score).toBeGreaterThanOrEqual(35);
      expect(score).toBeLessThanOrEqual(95);
      for (const value of Object.values(categories)) {
        expect(value).toBeGreaterThanOrEqual(35);
        expect(value).toBeLessThanOrEqual(95);
      }
    }
  });

  it("derives the §5 band distribution over the 78 unique pairs: 10/26/6/33/3", () => {
    const counts: Record<string, number> = {};
    for (const slug of allCanonicalPairs()) {
      const [a, b] = slug.split("-") as [ZodiacSign, ZodiacSign];
      const { band } = signCompatibilityScores(a, b);
      counts[band] = (counts[band] ?? 0) + 1;
    }
    expect(counts).toEqual({
      Excellent: 10,
      Strong: 26,
      Mixed: 6,
      Challenging: 33,
      "Very challenging": 3,
    });
  });

  it("has exactly the three Very challenging pairs and §5 extremes", () => {
    const veryChallenging = new Set<string>();
    let min: { slug: string; score: number } | null = null;
    let max: { slug: string; score: number } | null = null;
    for (const [a, b] of orderedPairs()) {
      const { score, band } = signCompatibilityScores(a, b);
      const slug = canonicalPairSlug(a, b);
      if (band === "Very challenging") veryChallenging.add(slug);
      if (!min || score < min.score) min = { slug, score };
      if (!max || score > max.score) max = { slug, score };
    }
    expect([...veryChallenging].sort()).toEqual([
      "aries-cancer", // 38
      "gemini-pisces", // 39
      "virgo-sagittarius", // 39
    ]);
    expect(min).toEqual({ slug: "aries-cancer", score: 38 });
    expect(max).toEqual({ slug: "aries-leo", score: 91 });
  });

  it("is symmetric across all 144 ordered lookups", () => {
    for (const [a, b] of orderedPairs()) {
      const ab = signCompatibilityScores(a, b);
      const ba = signCompatibilityScores(b, a);
      expect(ba).toEqual(ab);
      const fab = signCompatibilityFacts(a, b);
      const fba = signCompatibilityFacts(b, a);
      expect(fba).toEqual(fab);
    }
  });

  it("applies the §7 category offsets (spot vectors)", () => {
    // Aries–Leo 91: no water, fire same-element, trine (trust −2 non-axis).
    const leo = signCompatibilityScores("aries", "leo").categories;
    expect(leo).toEqual({
      love: 95,
      sexual: 95,
      friendship: 93,
      communication: 91,
      trust: 89,
      emotional: 91,
    });
    // Aries–Cancer 38: contrary fire–water, square; communication/trust clamped at the 35 floor.
    const cancer = signCompatibilityScores("aries", "cancer").categories;
    expect(cancer).toEqual({
      love: 42,
      sexual: 40,
      friendship: 36,
      communication: 35,
      trust: 35,
      emotional: 40,
    });
    // Aries–Libra 59: opposition chemistry +6; trust axis −8; air/water absent → emotional 59.
    const libra = signCompatibilityScores("aries", "libra").categories;
    expect(libra).toEqual({
      love: 63,
      sexual: 65,
      friendship: 61,
      communication: 59,
      trust: 51,
      emotional: 59,
    });
  });

  it("flags traditional-only shared rulers as disputed", () => {
    expect(signCompatibilityFacts("aries", "scorpio").shared_ruler).toEqual({
      planet: "Mars",
      disputed: true,
    });
    expect(signCompatibilityFacts("sagittarius", "pisces").shared_ruler).toEqual({
      planet: "Jupiter",
      disputed: true,
    });
    expect(signCompatibilityFacts("capricorn", "aquarius").shared_ruler).toEqual({
      planet: "Saturn",
      disputed: true,
    });
    expect(signCompatibilityFacts("gemini", "virgo").shared_ruler).toEqual({
      planet: "Mercury",
      disputed: false,
    });
    expect(signCompatibilityFacts("taurus", "libra").shared_ruler).toEqual({
      planet: "Venus",
      disputed: false,
    });
    expect(signCompatibilityFacts("aries", "taurus").shared_ruler).toBeNull();
    expect(signCompatibilityFacts("leo", "leo").shared_ruler).toBeNull();
  });

  it("rejects unknown signs loudly", () => {
    expect(() => signCompatibilityScores("ophiuchus" as ZodiacSign, "leo")).toThrow();
    expect(() => signPairResult("nonsense", "leo")).toThrow(UnknownSignError);
    expect(isZodiacSign("Aries")).toBe(false); // slugs are lowercase
  });
});

describe("sign-compatibility content pipeline (red until Epic ZC content lands)", () => {
  it("loads exactly 78 canonical pair records", () => {
    expect(PAIR_CONTENT_COUNT).toBe(78);
    expect(allCanonicalPairs().length).toBe(PAIR_CONTENT_COUNT);
  });

  it("has non-empty, in-bounds editorial content for every canonical pair", () => {
    for (const slug of allCanonicalPairs()) {
      const record = pairContent(slug);
      expect(record.overall.verdict.length).toBeGreaterThanOrEqual(40);
      for (const text of Object.values(record.categories)) {
        expect(text.length).toBeGreaterThanOrEqual(80);
      }
      expect(record.tips.length).toBeGreaterThanOrEqual(4);
      expect(record.tips.length).toBeLessThanOrEqual(6);
      for (const tip of record.tips) {
        expect(tip.length).toBeGreaterThan(0);
      }
    }
  });

  it("binds both sign display names into every record (wrong-sign guard)", () => {
    for (const slug of allCanonicalPairs()) {
      const record = pairContent(slug);
      const [aSlug, bSlug] = slug.split("-") as [ZodiacSign, ZodiacSign];
      const names = [aSlug, bSlug].map((s) => (s === "cancer" ? "Cancer" : cap(s)));
      const haystack = `${record.overall.verdict} ${Object.values(record.categories).join(" ")} ${record.tips.join(" ")}`;
      for (const name of new Set(names)) {
        expect(haystack.includes(name)).toBe(true);
      }
    }
  });

  it("assembles the full route payload for a representative pair", () => {
    const result = signPairResult("aries", "leo");
    expect(result.pair).toBe("aries-leo");
    expect(result.requested).toEqual({ sign1: "aries", sign2: "leo" });
    expect(result.verified).toBe(true); // content signed off 2026-11-22
    expect(result.categories.length).toBe(6);
    expect(result.categories.map((cat) => cat.key)).toEqual([
      "love",
      "sexual",
      "friendship",
      "communication",
      "trust",
      "emotional",
    ]);
    expect(result.tips.length).toBeGreaterThanOrEqual(4);
    expect(result.disclaimer).toContain("guidance and entertainment");
    // mirrored request resolves to the same canonical record
    const mirrored = signPairResult("leo", "aries");
    expect(mirrored.pair).toBe("aries-leo");
    expect(mirrored.overall).toEqual(result.overall);
    expect(mirrored.requested).toEqual({ sign1: "leo", sign2: "aries" });
  });
});

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
