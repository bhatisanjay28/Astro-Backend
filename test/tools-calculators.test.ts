/**
 * Epic 4.4/4.6 — calculator tools engine + route tests.
 */
import { describe, expect, it, test } from "bun:test";
import app from "../src/app";
import { lagna, planetaryPositions } from "../src/engine/kundli";
import {
  ageOn,
  flames,
  friendshipCompatibility,
  ishtaDevata,
  jaiminiKarakas,
  kaalSarp,
  loShuGrid,
  loveCompatibility,
  mobileNumerology,
  nameCompatibility,
  nameNumber,
  nameNumerology,
  vehicleLuckyNumber,
} from "../src/engine/tools";

const NATAL = {
  datetime: new Date("1990-06-15T06:30:00Z"),
  latitude: 28.6139,
  longitude: 77.209,
};

describe("tools engine", () => {
  test("nameNumber: Chaldean values sum to the documented root", () => {
    // R(2)+A(1)+M(4) = 7 → root 7
    expect(nameNumber("Ram").root).toBe(7);
    expect(nameNumber("Ram").sum).toBe(7);
    expect(nameNumber("RAM").root).toBe(7); // case-insensitive
  });

  test("loShuGrid: known digits land on the classical 3×3 map", () => {
    // 1990-06-15 → digits 1,9,9,0,6,1,5 → 1×2, 9×2, 6×1, 5×1; 0 dropped
    const r = loShuGrid("1990-06-15");
    const cell = (n: number) => r.grid.find((g) => g.number === n)?.count ?? 0;
    expect(cell(1)).toBe(2);
    expect(cell(9)).toBe(2);
    expect(cell(6)).toBe(1);
    expect(cell(5)).toBe(1);
    expect(cell(0)).toBe(0);
    expect(r.missing).toContain(4);
    expect(r.repeated).toEqual(expect.arrayContaining([1, 9]));
  });

  test("jaiminiKarakas: exactly 7 ranked karakas, AK has the max in-sign degree", () => {
    const karakas = jaiminiKarakas(planetaryPositions(NATAL));
    expect(karakas).toHaveLength(7);
    expect(karakas[0]?.karaka).toBe("Atmakaraka");
    expect(karakas[6]?.karaka).toBe("Darakaraka");
    const degs = karakas.map((k) => k.degree_in_sign);
    for (let i = 1; i < degs.length; i++) {
      expect(degs[i - 1] ?? 0).toBeGreaterThanOrEqual(degs[i] ?? 0);
    }
  });

  test("ishtaDevata: returns AK + navamsha sign, defers deity (P11)", () => {
    const r = ishtaDevata(planetaryPositions(NATAL));
    expect(r.ishta_devata).toBeNull();
    expect(r.note).toContain("P11");
    expect(r.navamsha_sign).toBeTruthy();
  });

  test("kaalSarp: structural validity on a real chart", () => {
    const input = NATAL;
    const positions = planetaryPositions(input);
    const asc = lagna(input);
    const r = kaalSarp(positions, asc.lon);
    expect([true, false]).toContain(r.present);
    expect(r.rahu_house).toBeGreaterThanOrEqual(1);
    expect(r.rahu_house).toBeLessThanOrEqual(12);
    if (r.present) {
      expect(r.type).toBeTruthy();
      expect(["rahu_to_ketu", "ketu_to_rahu"]).toContain(r.axis ?? "");
    } else {
      expect(r.type).toBeNull();
    }
  });

  test("flames: deterministic and symmetric on identical inputs", () => {
    expect(flames("Ram", "Sita")).toEqual(flames("Ram", "Sita"));
    const all = ["Friends", "Love", "Affection", "Marriage", "Enemy", "Sibling"];
    expect(all).toContain(flames("Ram", "Sita").result);
  });

  test("fun pair scores stay in the 55–95 band", () => {
    for (const fn of [loveCompatibility, friendshipCompatibility]) {
      const r = fn("Arjun", "Meera");
      expect(r.score).toBeGreaterThanOrEqual(55);
      expect(r.score).toBeLessThanOrEqual(95);
    }
    const nc = nameCompatibility("Arjun", "Meera");
    expect(nc.combined_root).toBeGreaterThanOrEqual(1);
    expect(nc.combined_root).toBeLessThanOrEqual(9);
  });

  test("vehicleLuckyNumber: mulank matches the day's digital root", () => {
    expect(vehicleLuckyNumber("1990-06-15").mulank).toBe(6); // 1+5
    expect(vehicleLuckyNumber("1990-06-28").mulank).toBe(1); // 2+8=10→1
  });

  test("mobileNumerology + nameNumerology roots", () => {
    expect(mobileNumerology("9876543210").sum).toBe(45);
    expect(mobileNumerology("9876543210").root).toBe(9);
    expect(nameNumerology("Ram").root).toBe(7);
  });

  test("ageOn: exact calendar age", () => {
    expect(ageOn("1990-06-15", "2026-11-19")).toEqual({
      years: 36,
      months: 5,
      days: 4,
      total_days: 13306,
    });
  });
});

describe("GET /api/v1/calculators routes", () => {
  const QS = "date=1990-06-15&time=12:00&lat=28.6139&lng=77.209&tz=Asia/Kolkata";

  it("rashi returns moon sign + nakshatra", async () => {
    const res = await app.request(`/api/v1/calculators/rashi?${QS}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { rashi: string; nakshatra: string; pada: number } };
    expect(json.data.rashi).toBeTruthy();
    expect(json.data.nakshatra).toBeTruthy();
    expect(json.data.pada).toBeGreaterThanOrEqual(1);
  });

  it("sade-sati, kaal-sarp, karakas, ishta-devata all respond with engine data", async () => {
    for (const tool of ["sade-sati", "kaal-sarp", "karakas", "ishta-devata"]) {
      const res = await app.request(`/api/v1/calculators/${tool}?${QS}`);
      expect(res.status).toBe(200);
    }
  });

  it("numerology suite endpoints validate and compute", async () => {
    const num = await app.request("/api/v1/calculators/numerology?date=1990-06-15&name=Ram");
    expect(num.status).toBe(200);
    const numJson = (await num.json()) as { data: { mulank: number; destiny: number } };
    expect(numJson.data.mulank).toBe(6);

    const lo = await app.request("/api/v1/calculators/lo-shu?date=1990-06-15");
    expect(lo.status).toBe(200);

    const veh = await app.request("/api/v1/calculators/vehicle-number?date=1990-06-15");
    expect(veh.status).toBe(200);

    const bad = await app.request("/api/v1/calculators/numerology?date=junk");
    expect(bad.status).toBe(400);
  });

  it("fun endpoints are labelled for_fun", async () => {
    for (const [path, qs] of [
      ["/calculators/flames", "a=Ram&b=Sita"],
      ["/calculators/love", "a=Ram&b=Sita"],
      ["/calculators/friendship", "a=Ram&b=Sita"],
      ["/calculators/name-compatibility", "a=Ram&b=Sita"],
      ["/calculators/mobile-numerology", "digits=9876543210"],
    ] as const) {
      const res = await app.request(`/api/v1${path}?${qs}`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: { for_fun?: boolean } };
      expect(json.data.for_fun).toBe(true);
    }
  });

  it("transits returns 9 grahas at now", async () => {
    const res = await app.request(
      "/api/v1/calculators/transits?lat=28.6139&lng=77.209&tz=Asia/Kolkata",
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { grahas: unknown[]; as_of: string } };
    expect(json.data.grahas).toHaveLength(9);
    expect(json.data.as_of).toBeTruthy();
  });

  it("age endpoint validates both dates", async () => {
    const ok = await app.request("/api/v1/calculators/age?date=1990-06-15&now=2026-11-19");
    expect(ok.status).toBe(200);
    const bad = await app.request("/api/v1/calculators/age?date=1990-06-15&now=junk");
    expect(bad.status).toBe(400);
  });
});
