/**
 * Muhurat rules — Epic 1.4 (PRD §5.4).
 *
 * ⚠️ RULES ARE DATA, NOT CODE (PRD §5.4). Every rule carries a `source` and
 * `verified: false` until a qualified Jyotishi reviews the set (P11 — launch
 * blocker). The finder is deterministic; the DATA is the part under review.
 *
 * Structure mirrors the `muhurat_rules` DB table so admin overrides (via the
 * backend, D3) can replace/extend this built-in baseline later.
 */
import type { Panchang } from "./panchang";

export const MUHURAT_EVENT_TYPES = [
  "marriage",
  "engagement",
  "griha_pravesh",
  "vehicle",
  "property",
  "business",
  "naamkaran",
  "mundan",
  "annaprashan",
  "travel",
] as const;

export type MuhuratEventType = (typeof MUHURAT_EVENT_TYPES)[number];

export type RuleKind =
  | "avoid_tithi" // params.tithi: 1-based tithi numbers (of 30)
  | "avoid_vaar" // params.vaar: 0=Sunday..6=Saturday
  | "avoid_nakshatra" // params.nakshatra: 1-based index (of 27)
  | "avoid_day_segment"; // params.segment: "rahu_kaal" | "yamaganda" | "gulika"

export interface MuhuratRule {
  id: string;
  event_type: MuhuratEventType;
  rule_name: string;
  kind: RuleKind;
  params: Record<string, unknown>;
  source: string;
  verified: false;
}

const SAMPLE_SOURCE =
  "SAMPLE STRUCTURE — classical muhurat references to be documented precisely and reviewed by a qualified Jyotishi before launch (P11)";

/**
 * Baseline rule set. Values are STRUCTURAL SAMPLES: the finder mechanics are
 * complete, but every threshold below must be confirmed by the Jyotishi review.
 */
export const DEFAULT_MUHURAT_RULES: MuhuratRule[] = [
  {
    id: "marriage-avoid-tithis",
    event_type: "marriage",
    rule_name: "avoid inauspicious tithis",
    kind: "avoid_tithi",
    params: { tithi: [4, 6, 8, 9, 12, 14, 23, 27, 29, 30] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "marriage-avoid-vaars",
    event_type: "marriage",
    rule_name: "avoid Tuesday and Saturday",
    kind: "avoid_vaar",
    params: { vaar: [2, 6] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "griha-pravesh-avoid-vaars",
    event_type: "griha_pravesh",
    rule_name: "avoid Tuesday, Saturday (sample set)",
    kind: "avoid_vaar",
    params: { vaar: [2, 6] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "travel-avoid-rahu-kaal",
    event_type: "travel",
    rule_name: "avoid Rahu Kaal window",
    kind: "avoid_day_segment",
    params: { segment: "rahu_kaal" },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "business-avoid-tithis",
    event_type: "business",
    rule_name: "avoid Amavasya (new-moon day)",
    kind: "avoid_tithi",
    params: { tithi: [30] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "naamkaran-avoid-tithis",
    event_type: "naamkaran",
    rule_name: "avoid Amavasya and Chaturthi (sample set)",
    kind: "avoid_tithi",
    params: { tithi: [4, 30] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "mundan-avoid-vaars",
    event_type: "mundan",
    rule_name: "avoid Tuesday (sample set)",
    kind: "avoid_vaar",
    params: { vaar: [2] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "engagement-avoid-tithis",
    event_type: "engagement",
    rule_name: "avoid Amavasya (sample set)",
    kind: "avoid_tithi",
    params: { tithi: [30] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "vehicle-avoid-tithis",
    event_type: "vehicle",
    rule_name: "avoid Amavasya and Ashtami (sample set)",
    kind: "avoid_tithi",
    params: { tithi: [8, 30] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "property-avoid-vaars",
    event_type: "property",
    rule_name: "avoid Tuesday (sample set)",
    kind: "avoid_vaar",
    params: { vaar: [2] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
  {
    id: "annaprashan-avoid-tithis",
    event_type: "annaprashan",
    rule_name: "avoid Amavasya (sample set)",
    kind: "avoid_tithi",
    params: { tithi: [30] },
    source: SAMPLE_SOURCE,
    verified: false,
  },
];

export interface RuleEvaluation {
  rule_id: string;
  rule_name: string;
  kind: RuleKind;
  passed: boolean;
  detail: string;
  source: string;
  verified: false;
}

/** Evaluate the rules for `event` against one day's Panchang. */
export function evaluateRules(
  event: MuhuratEventType,
  panchang: Panchang,
  rules: MuhuratRule[] = DEFAULT_MUHURAT_RULES,
): RuleEvaluation[] {
  const out: RuleEvaluation[] = [];
  const applicable = rules.filter((r) => r.event_type === event);
  // The limb active at sunrise is the day's headline limb (traditional display).
  const tithiAtSunrise = panchang.tithi[0]?.index ?? 0;
  const nakshatraAtSunrise = panchang.nakshatra[0]?.index ?? 0;
  const vaarName = panchang.vaar.name;
  const vaarIndex = [
    "Ravivara",
    "Somavara",
    "Mangalavara",
    "Budhavara",
    "Guruvara",
    "Shukravara",
    "Shanivara",
  ].indexOf(vaarName);

  for (const rule of applicable) {
    let passed = true;
    let detail = "";
    if (rule.kind === "avoid_tithi") {
      const list = (rule.params.tithi as number[]) ?? [];
      passed = !list.includes(tithiAtSunrise);
      detail = passed
        ? `Tithi ${tithiAtSunrise} not in avoided set [${list.join(", ")}]`
        : `Tithi ${tithiAtSunrise} is in avoided set [${list.join(", ")}]`;
    } else if (rule.kind === "avoid_vaar") {
      const list = (rule.params.vaar as number[]) ?? [];
      passed = !list.includes(vaarIndex);
      detail = passed ? `${vaarName} not in avoided weekdays` : `${vaarName} is an avoided weekday`;
    } else if (rule.kind === "avoid_nakshatra") {
      const list = (rule.params.nakshatra as number[]) ?? [];
      passed = !list.includes(nakshatraAtSunrise);
      detail = passed
        ? `Nakshatra ${nakshatraAtSunrise} not in avoided set`
        : `Nakshatra ${nakshatraAtSunrise} is in avoided set`;
    } else if (rule.kind === "avoid_day_segment") {
      // Segment rules cannot invalidate the whole day — they shrink the window.
      passed = true;
      detail = `Exclude ${rule.params.segment} window when scheduling inside this day`;
    }
    out.push({
      rule_id: rule.id,
      rule_name: rule.rule_name,
      kind: rule.kind,
      passed,
      detail,
      source: rule.source,
      verified: rule.verified,
    });
  }
  return out;
}
