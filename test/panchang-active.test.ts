import { describe, expect, it } from "bun:test";
import { computePanchang, ENGINE_VERSION, type LimbWindow, pickActiveLimb } from "../src/engine";

/**
 * Epic 9.3 (D12) — the server picks "what the user should see right now".
 * The frontend renders `active`; it never re-derives current/next limbs, so
 * the picking must be deterministic and fully covered here.
 */
function win(start: string, end: string, name: string): LimbWindow {
  return { index: 1, name, start, end, end_kind: "crossing" };
}

describe("pickActiveLimb", () => {
  const windows = [
    win("2026-11-19T00:00:00Z", "2026-11-19T06:00:00Z", "first"),
    win("2026-11-19T06:00:00Z", "2026-11-19T12:00:00Z", "second"),
    win("2026-11-19T12:00:00Z", "2026-11-19T18:00:00Z", "third"),
  ];

  it("picks the window containing now and the next one", () => {
    const now = new Date("2026-11-19T07:00:00Z");
    const picked = pickActiveLimb(windows, now);
    expect(picked.window?.name).toBe("second");
    expect(picked.next?.name).toBe("third");
  });

  it("treats a window start as inside and its end as the next window's start", () => {
    const atBoundary = pickActiveLimb(windows, new Date("2026-11-19T06:00:00Z"));
    expect(atBoundary.window?.name).toBe("second");
    expect(atBoundary.next?.name).toBe("third");
  });

  it("falls back to the last started window when now is past every window", () => {
    const now = new Date("2026-11-19T20:00:00Z");
    const picked = pickActiveLimb(windows, now);
    expect(picked.window?.name).toBe("third");
    expect(picked.next).toBeNull();
  });

  it("falls back to the earliest window when now precedes every window", () => {
    const now = new Date("2026-11-18T20:00:00Z");
    const picked = pickActiveLimb(windows, now);
    expect(picked.window?.name).toBe("first");
    expect(picked.next?.name).toBe("first");
  });

  it("returns nulls for an empty window list", () => {
    expect(pickActiveLimb([], new Date("2026-11-19T07:00:00Z"))).toEqual({
      window: null,
      next: null,
    });
  });
});

describe("computePanchang active limbs (Epic 9.3)", () => {
  const input = {
    date: "2026-11-19",
    latitude: 28.6139,
    longitude: 77.209,
    timezone: "Asia/Kolkata",
    city: { slug: "new-delhi", name: "New Delhi" },
    nowOverride: "2026-11-19T05:30:00Z", // 11:00 IST — midday
  };

  it("anchors picks to nowOverride and never leaks picking to the client", () => {
    const p = computePanchang(input);
    expect(p.engine_version).toBe(ENGINE_VERSION);
    expect(p.active.as_of).toBe(input.nowOverride);
    for (const limb of ["tithi", "nakshatra", "yoga", "karana"] as const) {
      const active = p.active[limb];
      if (active.window) {
        expect(p[limb]).toContainEqual(active.window);
      }
      if (active.next) {
        expect(p[limb]).toContainEqual(active.next);
      }
    }
  });

  it("keeps current before next chronologically within the same limb", () => {
    const p = computePanchang(input);
    const { window, next } = p.active.tithi;
    if (window && next) {
      expect(new Date(next.start).getTime()).toBeGreaterThanOrEqual(new Date(window.end).getTime());
    }
  });

  it("uses sunrise as the deterministic as_of for a non-today queried date", () => {
    const p = computePanchang({ ...input, date: "2026-01-15", nowOverride: undefined });
    expect(p.active.as_of).toBe(p.vedic_day.sunrise);
    expect(p.active.tithi.window).not.toBeNull();
  });
});
