import { describe, expect, it } from "bun:test";
import { hinduCalendar } from "../src/engine";

/**
 * Anchors: the home design sample (2026-11-19 → "Kartika • Vikram 2083") and
 * published panchang conventions (Purnimanta month flips at Purnima;
 * Vikram/Shaka increment at Chaitra Shukla 1 = new moon with Sun in Pisces).
 */
describe("hinduCalendar (Epic 1.7)", () => {
  it("2026-11-19 Delhi → Kartika Purnimanta, Shukla paksha, Vikram 2083, Shaka 1948", () => {
    const r = hinduCalendar(new Date("2026-11-19T04:00:00Z"), 9); // Shukla Dashami
    expect(r.amanta.name).toBe("Kartika");
    expect(r.purnimanta.name).toBe("Kartika");
    expect(r.paksha.name).toBe("Shukla");
    expect(r.adhika).toBe(false);
    expect(r.samvat.vikram).toBe(2083);
    expect(r.samvat.shaka).toBe(1948);
    expect(r.amanta.name_hi).toBe("कार्तिक");
  });

  it("2026-01-15 (Krishna) → Amanta Pausha but Purnimanta Magha, Vikram 2082", () => {
    const r = hinduCalendar(new Date("2026-01-15T04:00:00Z"), 20); // Krishna paksha
    expect(r.amanta.name).toBe("Pausha");
    expect(r.purnimanta.name).toBe("Magha"); // flips at Purnima (Paush Purnima Jan 3)
    expect(r.paksha.name).toBe("Krishna");
    expect(r.samvat.vikram).toBe(2082); // before Chaitra Shukla 1 (Mar 2026)
    expect(r.samvat.shaka).toBe(1947);
  });

  it("Vikram/Shaka increment at Chaitra Shukla 1 (Mar 2026)", () => {
    const before = hinduCalendar(new Date("2026-03-01T04:00:00Z"), 5);
    expect(before.purnimanta.name).toBe("Phalguna");
    expect(before.samvat.vikram).toBe(2082);
    const after = hinduCalendar(new Date("2026-03-20T04:00:00Z"), 5);
    expect(after.purnimanta.name).toBe("Chaitra");
    expect(after.samvat.vikram).toBe(2083);
    expect(after.samvat.shaka).toBe(1948);
  });

  it("2026-11-30 (Krishna) → Purnimanta Margashirsha (month ahead of Amanta)", () => {
    const r = hinduCalendar(new Date("2026-11-30T04:00:00Z"), 20);
    expect(r.amanta.name).toBe("Kartika");
    expect(r.purnimanta.name).toBe("Margashirsha");
  });

  it("paksha follows the tithi index split (0..14 Shukla, 15..29 Krishna)", () => {
    const d = new Date("2026-11-19T04:00:00Z");
    expect(hinduCalendar(d, 0).paksha.name).toBe("Shukla");
    expect(hinduCalendar(d, 14).paksha.name).toBe("Shukla"); // Purnima
    expect(hinduCalendar(d, 15).paksha.name).toBe("Krishna"); // Pratipada (wane)
    expect(hinduCalendar(d, 29).paksha.name).toBe("Krishna"); // Amavasya
  });

  it("never throws across a full year of days (new-moon search robustness)", () => {
    for (let day = 0; day < 365; day += 7) {
      const d = new Date(Date.UTC(2026, 0, 1) + day * 86400000);
      const r = hinduCalendar(d, day % 30);
      expect(r.amanta.name.length).toBeGreaterThan(0);
      expect(r.samvat.vikram).toBeGreaterThanOrEqual(2082);
      expect(r.samvat.vikram).toBeLessThanOrEqual(2083);
    }
  });
});
