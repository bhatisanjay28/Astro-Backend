/**
 * Muhurat finder (Epic 1.4) — deterministic evaluation of rules-as-data over a
 * date range. Candidate in-day windows shrink around inauspicious segments
 * (Rahu Kaal etc.); verdicts aggregate the rule evaluations.
 *
 * ⚠️ The DATA carries `verified: false` pending Jyotishi review (P11). The
 * response states this explicitly — never present as final guidance (PRD §5.4).
 */

import {
  DEFAULT_MUHURAT_RULES,
  evaluateRules,
  MUHURAT_EVENT_TYPES,
  type MuhuratEventType,
  type MuhuratRule,
  type RuleEvaluation,
} from "./muhurat-rules";
import { computePanchang, type Panchang, type Segment } from "./panchang";

export interface MuhuratDayResult {
  date: string;
  verdict: "suitable" | "conditional" | "unsuitable";
  vaar: string;
  failing_rules: Array<{ rule_id: string; rule_name: string; detail: string }>;
  evaluations: RuleEvaluation[];
  candidate_windows: Array<{
    name: string;
    start: string;
    end: string;
    exclusions: string[];
  }>;
}

export interface MuhuratFinderResult {
  event: MuhuratEventType;
  timezone: string;
  days: MuhuratDayResult[];
  disclaimer: string;
  rules_reviewed: false;
  engine_version: string;
}

const DISCLAIMER =
  "Muhurat windows are computed from a sample rule set that has NOT yet been reviewed by a qualified Jyotishi. Treat as indicative only (PRD §5.4 / placeholder P11).";

function shrinkWindows(
  panchang: Panchang,
  event: MuhuratEventType,
  rules: MuhuratRule[],
): MuhuratDayResult["candidate_windows"] {
  // Base candidate: Abhijit Muhurta (always auspicious) + the whole daytime span
  // outside the avoided segments.
  const windows: MuhuratDayResult["candidate_windows"] = [];
  const segRules = rules.filter((r) => r.event_type === event && r.kind === "avoid_day_segment");
  const avoided: Segment[] = [];
  for (const r of segRules) {
    const key = r.params.segment as string;
    if (key === "rahu_kaal") avoided.push(panchang.rahu_kaal);
    else if (key === "yamaganda") avoided.push(panchang.yamaganda);
    else if (key === "gulika") avoided.push(panchang.gulika);
  }

  windows.push({
    name: "Abhijit Muhurta",
    start: panchang.abhijit.start,
    end: panchang.abhijit.end,
    exclusions: [],
  });

  // Daytime span minus avoided segments → merged free intervals
  const sunrise = new Date(panchang.vedic_day.sunrise).getTime();
  const sunset = new Date(panchang.vedic_day.sunset).getTime();
  const cuts = avoided
    .map((s) => ({ s: new Date(s.start).getTime(), e: new Date(s.end).getTime() }))
    .sort((a, b) => a.s - b.s);
  let cursor = sunrise;
  const excl: string[] = [];
  for (const cut of cuts) {
    if (cut.s > cursor) {
      windows.push({
        name: "Daytime window",
        start: new Date(cursor).toISOString(),
        end: new Date(Math.min(cut.s, sunset)).toISOString(),
        exclusions: [...excl],
      });
    }
    if (cut.e > cursor) {
      cursor = Math.min(cut.e, sunset);
      const seg = avoided.find((s) => new Date(s.start).getTime() === cut.s);
      if (seg) excl.push(seg.name);
    }
  }
  if (cursor < sunset) {
    windows.push({
      name: "Daytime window",
      start: new Date(cursor).toISOString(),
      end: new Date(sunset).toISOString(),
      exclusions: [...excl],
    });
  }
  return windows;
}

export function findMuhurats(input: {
  event: MuhuratEventType;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (inclusive)
  latitude: number;
  longitude: number;
  timezone: string;
  rules?: MuhuratRule[];
}): MuhuratFinderResult {
  const { event, from, to, latitude, longitude, timezone, rules = DEFAULT_MUHURAT_RULES } = input;

  const days: MuhuratDayResult[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("invalid_date_range");
  }
  const rangeDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (rangeDays < 1 || rangeDays > 62) {
    throw new Error("date_range_out_of_bounds"); // keep requests bounded (PRD §14)
  }

  for (let i = 0; i < rangeDays; i++) {
    const dateISO = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    const panchang = computePanchang({ date: dateISO, latitude, longitude, timezone });
    const evaluations = evaluateRules(event, panchang, rules);
    const failing = evaluations.filter((e) => !e.passed);
    const hardBlocked = failing.some((e) => e.kind !== "avoid_day_segment");
    const verdict: MuhuratDayResult["verdict"] = hardBlocked
      ? "unsuitable"
      : failing.length > 0
        ? "conditional"
        : evaluations.length > 0
          ? "suitable"
          : "conditional";
    days.push({
      date: dateISO,
      verdict,
      vaar: panchang.vaar.name,
      failing_rules: failing.map((f) => ({
        rule_id: f.rule_id,
        rule_name: f.rule_name,
        detail: f.detail,
      })),
      evaluations,
      candidate_windows: shrinkWindows(panchang, event, rules),
    });
  }

  return {
    event,
    timezone,
    days,
    disclaimer: DISCLAIMER,
    rules_reviewed: false,
    engine_version: "1.0.0-alpha1",
  };
}

export { MUHURAT_EVENT_TYPES };
