import { describe, expect, it } from "bun:test";
import {
  choghadiyaDay,
  choghadiyaDaySequence,
  choghadiyaNightSequence,
  computePanchang,
  horaDay,
} from "../src/engine";

const NAMES = ["Udveg", "Char", "Labh", "Amrit", "Kaal", "Shubh", "Rog"];

/** Canonical weekday grid — cross-checked against drikpanchang + AstroSage tables. */
const CANONICAL_DAY = [
  ["Udveg", "Char", "Labh", "Amrit", "Kaal", "Shubh", "Rog", "Udveg"], // Sun
  ["Amrit", "Kaal", "Shubh", "Rog", "Udveg", "Char", "Labh", "Amrit"], // Mon
  ["Rog", "Udveg", "Char", "Labh", "Amrit", "Kaal", "Shubh", "Rog"], // Tue
  ["Labh", "Amrit", "Kaal", "Shubh", "Rog", "Udveg", "Char", "Labh"], // Wed
  ["Shubh", "Rog", "Udveg", "Char", "Labh", "Amrit", "Kaal", "Shubh"], // Thu
  ["Char", "Labh", "Amrit", "Kaal", "Shubh", "Rog", "Udveg", "Char"], // Fri
  ["Kaal", "Shubh", "Rog", "Udveg", "Char", "Labh", "Amrit", "Kaal"], // Sat
];
const CANONICAL_NIGHT = [
  ["Shubh", "Amrit", "Char", "Rog", "Kaal", "Labh", "Udveg", "Shubh"],
  ["Char", "Rog", "Kaal", "Labh", "Udveg", "Shubh", "Amrit", "Char"],
  ["Kaal", "Labh", "Udveg", "Shubh", "Amrit", "Char", "Rog", "Kaal"],
  ["Udveg", "Shubh", "Amrit", "Char", "Rog", "Kaal", "Labh", "Udveg"],
  ["Amrit", "Char", "Rog", "Kaal", "Labh", "Udveg", "Shubh", "Amrit"],
  ["Rog", "Kaal", "Labh", "Udveg", "Shubh", "Amrit", "Char", "Rog"],
  ["Labh", "Udveg", "Shubh", "Amrit", "Char", "Rog", "Kaal", "Labh"],
];

describe("Choghadiya sequences (Epic 1.7)", () => {
  it("all 7 weekday DAY sequences match the canonical grid", () => {
    for (let v = 0; v < 7; v++) {
      const seq = choghadiyaDaySequence(v).map((i) => NAMES[i] ?? "?");
      expect(seq).toEqual(CANONICAL_DAY[v] ?? []);
    }
  });

  it("all 7 weekday NIGHT sequences match the canonical grid", () => {
    for (let v = 0; v < 7; v++) {
      const seq = choghadiyaNightSequence(v).map((i) => NAMES[i] ?? "?");
      expect(seq).toEqual(CANONICAL_NIGHT[v] ?? []);
    }
  });

  it("REGRESSION: Thursday 2026-11-19 Delhi matches drikpanchang's live table", () => {
    const p = computePanchang({
      date: "2026-11-19",
      latitude: 28.6139,
      longitude: 77.209,
      timezone: "Asia/Kolkata",
    });
    const day = p.choghadiya.day.map((s) => s.name);
    const night = p.choghadiya.night.map((s) => s.name);
    // drikpanchang (Delhi, 19 Nov 2026): day Shubha→…→Shubha, night Amrita→…→Amrita
    expect(day).toEqual(CANONICAL_DAY[4] ?? []);
    expect(night).toEqual(CANONICAL_NIGHT[4] ?? []);
  });

  it("slots tile the day and night spans exactly (8 each, contiguous)", () => {
    const sunrise = new Date("2026-11-19T01:18:00Z");
    const sunset = new Date("2026-11-19T11:54:00Z");
    const nextSunrise = new Date("2026-11-20T01:19:00Z");
    const { day, night } = choghadiyaDay(4, sunrise, sunset, nextSunrise);
    expect(day.length).toBe(8);
    expect(night.length).toBe(8);
    expect(day[0]?.start).toBe(sunrise.toISOString());
    expect(day[7]?.end).toBe(sunset.toISOString());
    expect(night[0]?.start).toBe(sunset.toISOString());
    expect(night[7]?.end).toBe(nextSunrise.toISOString());
    for (let k = 1; k < 8; k++) {
      expect(day[k]?.start).toBe(day[k - 1]?.end);
      expect(night[k]?.start).toBe(night[k - 1]?.end);
    }
  });

  it("nature + lord pairs follow the classical mapping", () => {
    const { day } = choghadiyaDay(
      0,
      new Date("2026-11-22T01:30:00Z"),
      new Date("2026-11-22T12:00:00Z"),
      new Date("2026-11-23T01:31:00Z"),
    );
    expect(day[0]?.name).toBe("Udveg");
    expect(day[0]?.lord).toBe("Sun");
    expect(day[0]?.nature).toBe("inauspicious");
    expect(day[3]?.name).toBe("Amrit");
    expect(day[3]?.lord).toBe("Moon");
    expect(day[3]?.nature).toBe("auspicious");
  });
});

describe("Hora (Epic 1.7)", () => {
  it("Sunday day horas start at the Sun and cycle the Chaldean order", () => {
    const { day } = horaDay(
      0,
      new Date("2026-11-22T01:30:00Z"),
      new Date("2026-11-22T12:00:00Z"),
      new Date("2026-11-23T01:31:00Z"),
    );
    const lords = day.map((h) => h.lord);
    expect(lords).toEqual([
      "Sun",
      "Venus",
      "Mercury",
      "Moon",
      "Saturn",
      "Jupiter",
      "Mars",
      "Sun",
      "Venus",
      "Mercury",
      "Moon",
      "Saturn",
    ]);
    expect(day[0]?.nature).toBe("inauspicious"); // Sun hora
    expect(day[3]?.nature).toBe("auspicious"); // Moon hora
  });

  it("night horas continue the 24-hour cycle (Sunday night begins Jupiter)", () => {
    const { night } = horaDay(
      0,
      new Date("2026-11-22T01:30:00Z"),
      new Date("2026-11-22T12:00:00Z"),
      new Date("2026-11-23T01:31:00Z"),
    );
    expect(night.map((h) => h.lord)).toEqual([
      "Jupiter",
      "Mars",
      "Sun",
      "Venus",
      "Mercury",
      "Moon",
      "Saturn",
      "Jupiter",
      "Mars",
      "Sun",
      "Venus",
      "Mercury",
    ]);
  });

  it("Monday horas start at the Moon; counts are 12 + 12", () => {
    const { day, night } = horaDay(
      1,
      new Date("2026-11-23T01:30:00Z"),
      new Date("2026-11-23T12:00:00Z"),
      new Date("2026-11-24T01:31:00Z"),
    );
    expect(day.length).toBe(12);
    expect(night.length).toBe(12);
    expect(day[0]?.lord).toBe("Moon");
    expect(day[0]?.lord_hi).toBe("चंद्र");
  });
});
