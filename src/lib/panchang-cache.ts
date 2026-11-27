/**
 * Epic 3.1b — panchang_cache write-through (PRD §8/§10). Panchang output is
 * deterministic per (city, date), so city-mode reads hit the Supabase cache
 * first and every miss writes back (also warmed nightly by the cron trigger).
 * Pruning keeps only recent days — old dates are always computable on demand.
 */

import { ENGINE_VERSION } from "../engine/panchang";
import { rest, type SupabaseCreds } from "./supabase";

export interface CachedPanchang {
  payload: Record<string, unknown>;
  computedAt: string;
}

export async function getCachedPanchang(
  creds: SupabaseCreds,
  cityId: string,
  date: string,
): Promise<CachedPanchang | null> {
  const res = await rest(
    creds,
    `panchang_cache?city_id=eq.${cityId}&date=eq.${date}&select=payload,engine_version,computed_at&limit=1`,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{
    payload: Record<string, unknown>;
    engine_version: string | null;
    computed_at: string;
  }>;
  const row = rows[0];
  if (!row) return null;
  // S24: rows computed by an older engine lack bilingual names (tithi/yoga/
  // karana name_hi) — treat them as a miss so the write-through recomputes
  // with the current engine instead of serving partial localization for the
  // remaining prune window.
  if ((row.engine_version ?? "unknown") !== ENGINE_VERSION) return null;
  return { payload: row.payload, computedAt: row.computed_at };
}

export async function storePanchang(
  creds: SupabaseCreds,
  cityId: string,
  date: string,
  timezone: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const res = await rest(creds, "panchang_cache?on_conflict=city_id,date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      {
        city_id: cityId,
        date,
        timezone,
        payload,
        engine_version: payload.engine_version ?? "unknown",
      },
    ]),
  });
  return res.ok;
}

/** Drop cache rows older than `keepDays` (cron hygiene). */
export async function prunePanchangCache(creds: SupabaseCreds, keepDays = 7): Promise<boolean> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const res = await rest(creds, `panchang_cache?date=lt.${cutoff}`, { method: "DELETE" });
  return res.ok;
}
