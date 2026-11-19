/**
 * Divisional (varga) charts D3/D7/D9/D10/D12 (Epic 1.10, PRD §5.5).
 *
 * Parashari varga rules over a longitude (0–360 sidereal):
 *  - D3 Drekkana: 3 parts of 10°; part p (0..2) → sign + 4p  (1st→self,
 *    2nd→5th, 3rd→9th from the sign).
 *  - D7 Saptamsha: 7 parts of 30/7°; odd signs start from self, even signs
 *    from the 7th sign from self.
 *  - D9 Navamsha: 9 parts of 3°20′; continuous (sign×9 + part) — identical
 *    to kundli.navamshaSignIndex (kept in sync by test).
 *  - D10 Dashamsha: 10 parts of 3°; odd signs start from self, even signs
 *    from the 9th sign from self.
 *  - D12 Dwadashamsha: 12 parts of 2.5°; starts from self for every sign.
 *  (Classical parity: Aries = odd, i.e. signIndex % 2 === 0.)
 */

export type DivisionalChart = "D3" | "D7" | "D9" | "D10" | "D12";

function norm(lon: number): number {
  return ((lon % 360) + 360) % 360;
}

function signIdx(lon: number): number {
  return Math.floor(norm(lon) / 30) % 12;
}

function partOf(lon: number, parts: number): number {
  return Math.floor((norm(lon) - signIdx(lon) * 30) / (30 / parts));
}

export function drekkanaSignIndex(lon: number): number {
  return (signIdx(lon) + 4 * partOf(lon, 3)) % 12;
}

export function saptamshaSignIndex(lon: number): number {
  const s = signIdx(lon);
  const odd = s % 2 === 0;
  return (s + (odd ? 0 : 6) + partOf(lon, 7)) % 12;
}

export function dashamshaSignIndex(lon: number): number {
  const s = signIdx(lon);
  const odd = s % 2 === 0;
  return (s + (odd ? 0 : 8) + partOf(lon, 10)) % 12;
}

export function dwadashamshaSignIndex(lon: number): number {
  return (signIdx(lon) + partOf(lon, 12)) % 12;
}

/** Map a longitude to the sign index of the given divisional chart. */
export function divisionalSignIndex(lon: number, chart: DivisionalChart): number {
  switch (chart) {
    case "D3":
      return drekkanaSignIndex(lon);
    case "D7":
      return saptamshaSignIndex(lon);
    case "D9":
      return (Math.floor(norm(lon) / 30) * 9 + partOf(lon, 9)) % 12;
    case "D10":
      return dashamshaSignIndex(lon);
    case "D12":
      return dwadashamshaSignIndex(lon);
  }
}

export const DIVISIONAL_CHARTS: DivisionalChart[] = ["D3", "D7", "D9", "D10", "D12"];

/** All supported divisionals for one longitude → { D3: idx, ... }. */
export function divisionalsOf(lon: number): Record<DivisionalChart, number> {
  return {
    D3: drekkanaSignIndex(lon),
    D7: saptamshaSignIndex(lon),
    D9: divisionalSignIndex(lon, "D9"),
    D10: dashamshaSignIndex(lon),
    D12: dwadashamshaSignIndex(lon),
  };
}
