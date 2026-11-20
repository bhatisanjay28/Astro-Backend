/**
 * GET /api/v1/settings — public site settings (Epic 1.9 + 5.4 + 7.4 wiring).
 *
 * Engine configuration (PRD §8) + the public.* settings the frontend needs
 * (gemstones outbound URL, contact email, WhatsApp click-to-chat). Values live
 * in Supabase `site_settings` (RLS public-read for `public.%` keys); the
 * admin manages them in Epic 6.4. Unknown/invalid engine values degrade to
 * defaults and are reported via `sources` (never silently).
 */
import { Hono } from "hono";
import {
  DEFAULT_ENGINE_CONFIG,
  ENGINE_CONFIG_KEYS,
  type EngineConfigKey,
  resolveEngineConfig,
} from "../../engine/config";
import type { AppEnv } from "../../env";

export const settingsRoute = new Hono<AppEnv>();

const ENGINE_SETTING_KEYS: Record<EngineConfigKey, string> = {
  ayanamsha: "public.engine_ayanamsha",
  month_system: "public.engine_month_system",
  house_system: "public.engine_house_system",
  chart_style: "public.engine_chart_style",
};

const EXTRA_KEYS = [
  "public.gemstones_site_url",
  "public.contact_email",
  "public.contact_whatsapp",
  "public.offers_config",
] as const;

settingsRoute.get("/settings", async (c) => {
  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "Settings require backend database credentials, which are not configured on this deployment yet.",
        },
      },
      503,
    );
  }

  const allKeys = [...Object.values(ENGINE_SETTING_KEYS), ...EXTRA_KEYS];
  const params = new URLSearchParams({
    select: "key,value",
    key: `in.(${allKeys.map((k) => `"${k}"`).join(",")})`,
  });

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/site_settings?${params.toString()}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
  } catch {
    return c.json({ error: { code: "internal_error", message: "Settings lookup failed" } }, 500);
  }
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Settings lookup failed" } }, 500);
  }

  const rows = (await res.json()) as Array<{ key: string; value: unknown }>;
  const dbByKey = new Map(rows.map((r) => [r.key, r.value]));

  // Engine config: jsonb scalars arrive decoded as strings.
  const engineDb: Partial<Record<EngineConfigKey, unknown>> = {};
  for (const [cfgKey, settingKey] of Object.entries(ENGINE_SETTING_KEYS) as Array<
    [EngineConfigKey, string]
  >) {
    if (dbByKey.has(settingKey)) engineDb[cfgKey] = dbByKey.get(settingKey);
  }
  const { config, sources } = resolveEngineConfig(engineDb);

  const decodeString = (key: string): string | null => {
    const raw = dbByKey.get(key);
    if (typeof raw === "string" && raw.length > 0) return raw;
    return null; // empty string / missing / non-string → unset
  };

  return c.json({
    data: {
      engine: config,
      engine_sources: sources,
      gemstones_site_url: decodeString("public.gemstones_site_url"),
      contact_email: decodeString("public.contact_email"),
      contact_whatsapp: decodeString("public.contact_whatsapp"),
      // Epic 5.2 — offers banner config (admin-authored JSON; shape contract
      // lives in the frontend renderer: [{text, href?, audience?}]). Passed
      // through unvalidated here; the renderer fail-softs on anything else.
      offers_config: dbByKey.has("public.offers_config")
        ? (dbByKey.get("public.offers_config") ?? null)
        : null,
    },
    meta: {
      defaults: DEFAULT_ENGINE_CONFIG,
      editable_via: "site_settings table (admin, Epic 6.4)",
      config_keys: ENGINE_CONFIG_KEYS,
    },
  });
});
