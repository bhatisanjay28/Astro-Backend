/**
 * Planetary Hora — 12 day + 12 night hours of the vedic day
 * (Epic 1.7, PRD §5.3; surfaces with Choghadiya on Panchang surfaces).
 *
 * Rules (classical planetary hours):
 *  - Each hora is 1/12 of the daylight span (day) or night span (night).
 *  - The lords form one continuous Chaldean-order cycle starting at the
 *    weekday lord: hora k after sunrise is ruled by
 *    CHALDEAN[(weekdayLordIdx + k) % 7], continuing across sunset into night
 *    (so Sunday's night begins with Jupiter).
 *  - Nature: Moon/Venus/Mercury/Jupiter horas auspicious for beginnings;
 *    Sun/Mars/Saturn horas inauspicious (classical hora shastra).
 */
import { LocalizedName } from "./hinduCalendar";

export type HoraNature = "auspicious" | "inauspicious";

export interface HoraSlot {
  lord: string;
  lord_hi: string;
  nature: HoraNature;
  start: string; // ISO instant
  end: string;
}

const CHALDEAN = ["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"];
const WEEKDAY_LORDS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"];

const LORD_HI: Record<string, string> = {
  Sun: "सूर्य",
  Moon: "चंद्र",
  Mars: "मंगल",
  Mercury: "बुध",
  Jupiter: "गुरु",
  Venus: "शुक्र",
  Saturn: "शनि",
};

const BENEFIC = new Set(["Jupiter", "Venus", "Mercury", "Moon"]);

function horaLords(vaarIndex: number, count: number, offset: number): string[] {
  const start = CHALDEAN.indexOf(WEEKDAY_LORDS[((vaarIndex % 7) + 7) % 7] ?? "Sun");
  const lords: string[] = [];
  for (let k = 0; k < count; k++) {
    lords.push(CHALDEAN[(start + offset + k) % 7] ?? "Sun");
  }
  return lords;
}

function slots(lords: string[], startMs: number, endMs: number): HoraSlot[] {
  const span = (endMs - startMs) / lords.length;
  return lords.map((lord, k) => ({
    lord,
    lord_hi: LORD_HI[lord] ?? lord,
    nature: BENEFIC.has(lord) ? "auspicious" : "inauspicious",
    start: new Date(startMs + k * span).toISOString(),
    end: new Date(startMs + (k + 1) * span).toISOString(),
  }));
}

/** All 24 horas (12 day + 12 night) for one vedic day. */
export function horaDay(
  vaarIndex: number,
  sunrise: Date,
  sunset: Date,
  nextSunrise: Date,
): { day: HoraSlot[]; night: HoraSlot[] } {
  return {
    day: slots(horaLords(vaarIndex, 12, 0), sunrise.getTime(), sunset.getTime()),
    night: slots(horaLords(vaarIndex, 12, 12), sunset.getTime(), nextSunrise.getTime()),
  };
}
