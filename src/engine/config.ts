/**
 * Engine configurability (Epic 1.9, PRD §8): the site owner picks ayanamsha,
 * month system, house system and chart style; the values live in Supabase
 * `site_settings` (`public.engine_*` keys, admin-managed in Epic 6.4) and are
 * threaded through the engine/API as validated options.
 *
 * Phase-1 honesty rule: only the implemented values are legal. Unknown values
 * never silently fall through — the settings resolver marks them `invalid`
 * (served as defaults with a source map), and per-request options are
 * rejected with a 400 listing the allowed values. Adding a real second
 * ayanamsha/house system later = extending the allowed lists + implementing
 * the math.
 */

export interface EngineConfig {
  ayanamsha: "lahiri";
  month_system: "amanta" | "purnimanta";
  house_system: "whole_sign";
  chart_style: "north_indian" | "south_indian";
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  ayanamsha: "lahiri",
  month_system: "purnimanta",
  house_system: "whole_sign",
  chart_style: "north_indian",
};

export const ENGINE_CONFIG_KEYS = [
  "ayanamsha",
  "month_system",
  "house_system",
  "chart_style",
] as const;
export type EngineConfigKey = (typeof ENGINE_CONFIG_KEYS)[number];

/** Legal values per key — enforced everywhere (DB resolution + API options). */
export const ENGINE_CONFIG_ALLOWED: Record<EngineConfigKey, string[]> = {
  ayanamsha: ["lahiri"],
  month_system: ["amanta", "purnimanta"],
  house_system: ["whole_sign"],
  chart_style: ["north_indian", "south_indian"],
};

export interface EngineConfigResolution {
  config: EngineConfig;
  /** Where each value came from: the DB row, the default, or invalid→default. */
  sources: Record<EngineConfigKey, "db" | "default" | "invalid">;
}

/**
 * Resolve engine config from raw site_settings values (jsonb-decoded scalars).
 * Missing keys → default; unknown values → default flagged `invalid`.
 */
export function resolveEngineConfig(
  db: Partial<Record<EngineConfigKey, unknown>> | undefined,
): EngineConfigResolution {
  const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG };
  const sources = {
    ayanamsha: "default",
    month_system: "default",
    house_system: "default",
    chart_style: "default",
  } as EngineConfigResolution["sources"];
  if (db) {
    for (const key of ENGINE_CONFIG_KEYS) {
      const raw = db[key];
      if (raw === undefined || raw === null) continue;
      const value = typeof raw === "string" ? raw : String(raw);
      if ((ENGINE_CONFIG_ALLOWED[key] as string[]).includes(value)) {
        (config[key] as string) = value;
        sources[key] = "db";
      } else {
        sources[key] = "invalid";
      }
    }
  }
  return { config, sources };
}

/** Strict per-request validation → human-readable problems, [] when clean. */
export function engineConfigProblems(
  raw: Record<string, unknown> | undefined,
): Array<{ key: string; problem: string; allowed: string[] }> {
  if (!raw) return [];
  const problems: Array<{ key: string; problem: string; allowed: string[] }> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!(ENGINE_CONFIG_KEYS as readonly string[]).includes(key)) {
      problems.push({ key, problem: "unknown engine option", allowed: [...ENGINE_CONFIG_KEYS] });
      continue;
    }
    const allowed = ENGINE_CONFIG_ALLOWED[key as EngineConfigKey];
    if (typeof value !== "string" || !allowed.includes(value)) {
      problems.push({
        key,
        problem: typeof value === "string" ? "unsupported value" : "must be a string",
        allowed,
      });
    }
  }
  return problems;
}
