/**
 * POST /api/v1/kundli/match — Epic 4.1 route tests (Epic 1.8 engine behind it).
 */
import { describe, expect, it } from "bun:test";
import app from "../src/app";

const BOY = { date: "1990-06-15", time: "12:00", lat: 28.6139, lng: 77.209, tz: "Asia/Kolkata" };
const GIRL = { date: "1993-03-05", time: "14:00", lat: 19.076, lng: 72.8777, tz: "Asia/Kolkata" };

interface MatchResponse {
  data?: {
    ashtakoota: {
      boy: { moon_sign: string; moon_nakshatra: string };
      girl: { moon_sign: string; moon_nakshatra: string };
      kootas: Array<{ koota: string; points: number; max: number; detail: string }>;
      total: number;
      max: number;
      threshold: number;
      acceptable: boolean;
      verified: boolean;
    };
    manglik: {
      boy: { is_manglik: boolean };
      girl: { is_manglik: boolean };
      note: string;
    };
    engine_version: string;
  };
  meta?: { consent_note: string; verification_note: string };
  error?: { code: string; message: string };
}

async function postMatch(body: unknown): Promise<{ status: number; json: MatchResponse }> {
  const res = await app.request("/api/v1/kundli/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as MatchResponse };
}

describe("POST /api/v1/kundli/match", () => {
  it("returns the full Ashtakoota + Manglik envelope", async () => {
    const { status, json } = await postMatch({ boy: BOY, girl: GIRL });
    expect(status).toBe(200);
    const a = json.data?.ashtakoota;
    expect(a).toBeTruthy();
    expect(a?.kootas).toHaveLength(8);
    expect(a?.max).toBe(36);
    expect(a?.threshold).toBe(18);
    expect(a?.verified).toBe(false);
    const sum = a?.kootas.reduce((s, k) => s + k.points, 0) ?? 0;
    expect(a?.total).toBe(Math.round(sum * 10) / 10);
    expect(a?.boy.moon_sign).toBeTruthy();
    expect(a?.girl.moon_nakshatra).toBeTruthy();
    expect(json.data?.manglik.boy).toHaveProperty("is_manglik");
    expect(json.data?.manglik.note).toContain("Manglik");
    expect(json.data?.engine_version).toMatch(/^1\./);
    expect(json.meta?.consent_note).toContain("not stored");
    expect(json.meta?.verification_note).toContain("P11");
  });

  it("self-match gives the classical 28/36 identity", async () => {
    const { json } = await postMatch({ boy: BOY, girl: BOY });
    expect(json.data?.ashtakoota.total).toBe(28);
    expect(json.data?.ashtakoota.acceptable).toBe(true);
  });

  it("400s on validation problems for either person", async () => {
    const missing = await postMatch({ boy: BOY });
    expect(missing.status).toBe(400);
    expect(missing.json.error?.message).toContain("girl");

    const badDate = await postMatch({ boy: { ...BOY, date: "15-06-1990" }, girl: GIRL });
    expect(badDate.status).toBe(400);
    expect(badDate.json.error?.message).toContain("boy");

    const badTz = await postMatch({ boy: { ...BOY, tz: "Mars/Olympus" }, girl: GIRL });
    expect(badTz.status).toBe(400);
  });

  it("400s on unsupported engine options", async () => {
    const { status, json } = await postMatch({
      boy: BOY,
      girl: GIRL,
      options: { house_system: "placidus" },
    });
    expect(status).toBe(400);
    expect(json.error?.code).toBe("validation_error");
  });

  it("rejects non-JSON bodies", async () => {
    const res = await app.request("/api/v1/kundli/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});
