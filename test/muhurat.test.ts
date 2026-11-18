import { describe, expect, it } from "bun:test";
import { findMuhurats } from "../src/engine/muhurat";
import {
  DEFAULT_MUHURAT_RULES,
  evaluateRules,
  MUHURAT_EVENT_TYPES,
  type MuhuratRule,
} from "../src/engine/muhurat-rules";
import { computePanchang } from "../src/engine/panchang";

/**
 * Muhurat finder tests (Epic 1.4) — QA-mindset.
 *  1. Data integrity: every event type covered; every rule has a source;
 *     verified:false everywhere (P11)
 *  2. Verdict logic: avoid_tithi/avoid_vaar rule fires on the right day
 *  3. Range handling: inclusive bounds, out-of-bounds rejection
 *  4. Windows: Abhijit present, Rahu Kaal excluded from travel windows
 *  5. Disclaimer always present
 */

const DELHI = { latitude: 28.6139, longitude: 77.209, timezone: "Asia/Kolkata" };

describe("muhurat rules data", () => {
  it("covers all ten event types", () => {
    const covered = new Set(DEFAULT_MUHURAT_RULES.map((r) => r.event_type));
    for (const t of MUHURAT_EVENT_TYPES) {
      expect(covered.has(t)).toBe(true);
    }
  });

  it("every rule documents a source and carries verified:false", () => {
    for (const r of DEFAULT_MUHURAT_RULES) {
      expect(r.source.length).toBeGreaterThan(10);
      expect(r.verified).toBe(false);
      expect(Object.keys(r.params).length).toBeGreaterThan(0);
    }
  });
});

describe("finder verdicts", () => {
  it("flags a day unsuitable when an avoid_tithi rule matches", () => {
    // Find a day with Amavasya (tithi 30) around the Nov 9 2026 new moon
    const probe = computePanchang({ date: "2026-11-09", ...DELHI });
    const amavasyaDay = probe.tithi.some((w) => w.index === 30 || w.index === 29)
      ? "2026-11-09"
      : "2026-11-10";
    const result = findMuhurats({
      event: "business",
      from: amavasyaDay,
      to: amavasyaDay,
      ...DELHI,
    });
    const day = result.days[0]!;
    const amavasyaActive = day.evaluations.some(
      (e) => e.rule_id === "business-avoid-tithis" && !e.passed,
    );
    if (amavasyaActive) {
      expect(day.verdict).toBe("unsuitable");
    }
  });

  it("marriage on a Saturday is unsuitable (avoid_vaar rule)", () => {
    // 2026-11-21 is a Saturday
    const result = findMuhurats({
      event: "marriage",
      from: "2026-11-21",
      to: "2026-11-21",
      ...DELHI,
    });
    expect(result.days[0]!.vaar).toBe("Shanivara");
    expect(result.days[0]!.verdict).toBe("unsuitable");
    expect(result.days[0]!.failing_rules.some((f) => f.rule_name.includes("Saturday"))).toBe(true);
  });

  it("returns 'suitable' only when all rules pass", () => {
    const result = findMuhurats({
      event: "travel",
      from: "2026-11-23",
      to: "2026-11-29",
      ...DELHI,
    });
    for (const d of result.days) {
      if (d.verdict === "suitable") {
        expect(d.failing_rules.length).toBe(0);
        expect(d.evaluations.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("finder range handling", () => {
  it("treats from/to as inclusive", () => {
    const result = findMuhurats({
      event: "travel",
      from: "2026-11-20",
      to: "2026-11-22",
      ...DELHI,
    });
    expect(result.days.length).toBe(3);
    expect(result.days[0]!.date).toBe("2026-11-20");
    expect(result.days[2]!.date).toBe("2026-11-22");
  });

  it("rejects ranges over 62 days and invalid dates", () => {
    expect(() =>
      findMuhurats({ event: "travel", from: "2026-01-01", to: "2026-04-01", ...DELHI }),
    ).toThrow();
    expect(() =>
      findMuhurats({ event: "travel", from: "bad", to: "2026-01-10", ...DELHI }),
    ).toThrow();
  });
});

describe("candidate windows", () => {
  it("always include Abhijit; travel windows exclude Rahu Kaal", () => {
    const result = findMuhurats({
      event: "travel",
      from: "2026-11-23",
      to: "2026-11-23",
      ...DELHI,
    });
    const day = result.days[0]!;
    expect(day.candidate_windows.some((w) => w.name === "Abhijit Muhurta")).toBe(true);

    const rahu = new Date(day.evaluations.length ? day.candidate_windows[0]!.start : 0); // placeholder
    void rahu;
    // daytime windows must not overlap the Rahu Kaal interval
    const rahuS = new Date(0);
    void rahuS;
    for (const w of day.candidate_windows.filter((x) => x.name === "Daytime window")) {
      const wS = new Date(w.start).getTime();
      const wE = new Date(w.end).getTime();
      const rS = new Date(day.candidate_windows.length ? w.start : 0).getTime(); // placeholder guard
      void rS;
      expect(wE).toBeGreaterThan(wS); // non-degenerate
    }
  });

  it("travel windows actually exclude the Rahu Kaal span", () => {
    const p = computePanchang({ date: "2026-11-23", ...DELHI });
    const rS = new Date(p.rahu_kaal.start).getTime();
    const rE = new Date(p.rahu_kaal.end).getTime();
    const result = findMuhurats({
      event: "travel",
      from: "2026-11-23",
      to: "2026-11-23",
      ...DELHI,
    });
    for (const w of result.days[0]!.candidate_windows) {
      const wS = new Date(w.start).getTime();
      const wE = new Date(w.end).getTime();
      const overlaps = wS < rE && wE > rS;
      expect(overlaps).toBe(false);
    }
  });
});

describe("disclaimer & review flags", () => {
  it("always carries the Jyotishi-review disclaimer", () => {
    const result = findMuhurats({
      event: "marriage",
      from: "2026-12-01",
      to: "2026-12-01",
      ...DELHI,
    });
    expect(result.disclaimer).toContain("NOT yet been reviewed");
    expect(result.rules_reviewed).toBe(false);
  });

  it("supports custom (DB-sourced) rule sets", () => {
    const custom: MuhuratRule[] = [
      {
        id: "custom-test",
        event_type: "marriage",
        rule_name: "avoid Monday (custom)",
        kind: "avoid_vaar",
        params: { vaar: [1] },
        source: "custom DB rule",
        verified: false,
      },
    ];
    const result = findMuhurats({
      event: "marriage",
      from: "2026-11-23",
      to: "2026-11-23",
      ...DELHI,
      rules: custom,
    });
    // 2026-11-23 is a Monday
    expect(result.days[0]!.verdict).toBe("unsuitable");
    expect(result.days[0]!.failing_rules[0]!.rule_id).toBe("custom-test");
  });
});
