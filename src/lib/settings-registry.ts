/**
 * Admin Phase 4 — settings registry (Winston §8): every known site_settings
 * key declared in code with its group, label, English description, value
 * type, allowed values, the capability that may write it, and whether the
 * public /settings endpoint may serve it.
 *
 * The registry is both the validation AND the authorization contract:
 *  - PUT /admin/settings/:key 404s unknown keys, 400s wrong shapes with a
 *    field error, and picks the capability PER KEY (engine keys →
 *    settings.engine, nav keys → nav.write, the rest → settings.write);
 *  - engine keys additionally keep the defensive `public.engine_` prefix
 *    check in ops.ts, so a future registry mistake cannot re-open the
 *    phase-4 [P0] hole where role `admin` could rewrite the live engine
 *    (the old guard matched "engine." but the real keys are public.engine_*).
 *
 * The admin UI renders groups straight from GET /admin/settings — no
 * hardcoded key lists on the client (D12: content and config via API only).
 */
import { ENGINE_CONFIG_ALLOWED } from "../engine/config";

export type SettingType = "string" | "url" | "email" | "date" | "boolean" | "enum" | "json";

export type SettingCapability = "settings.write" | "settings.engine" | "nav.write";

export interface SettingDef {
  /** UI group card (rendered in registry order by the admin settings page) */
  group: string;
  label: string;
  description_en: string;
  type: SettingType;
  /** enum only — exhaustive value list (engine enums come from engine/config) */
  allowed?: readonly string[];
  /** capability required to PUT this key — checked server-side, per key */
  capability: SettingCapability;
  /** served by the public GET /settings endpoint (RLS floor: public.% keys) */
  public: boolean;
}

export const SETTINGS_REGISTRY: Record<string, SettingDef> = {
  "public.contact_email": {
    group: "General",
    label: "Contact email",
    description_en: "Shown on the contact page and in booking confirmation copy.",
    type: "email",
    capability: "settings.write",
    public: true,
  },
  "public.contact_whatsapp": {
    group: "General",
    label: "WhatsApp number",
    description_en: "Click-to-chat number (digits with optional + prefix, no spaces).",
    type: "string",
    capability: "settings.write",
    public: true,
  },
  "public.notify_launch_date": {
    group: "General",
    label: "Launch date",
    description_en: "Date shown in the launch-notify banner copy (YYYY-MM-DD).",
    type: "date",
    capability: "settings.write",
    public: true,
  },
  "public.gemstones_site_url": {
    group: "Features",
    label: "Gemstones partner URL",
    description_en: "Outbound partner link used by the gemstones recommendation calculator.",
    type: "url",
    capability: "settings.write",
    public: true,
  },
  "public.offers_config": {
    group: "Features",
    label: "Offers banner config",
    description_en:
      'JSON array of banner items: [{"text", "href?", "audience?"}] — the renderer fail-softs on anything else.',
    type: "json",
    capability: "settings.write",
    public: true,
  },
  "public.nav_config": {
    group: "Nav",
    label: "Navigation config",
    description_en:
      "Header nav tabs (frontend NavTab shape). Edited on the Nav screen; edited as JSON here only for emergencies.",
    type: "json",
    capability: "nav.write",
    public: true,
  },
  "public.home_sections": {
    group: "Nav",
    label: "Homepage sections",
    description_en:
      "Homepage section order/toggles JSON (advanced — full visual editor is a future phase).",
    type: "json",
    capability: "nav.write",
    public: true,
  },
  "public.engine_ayanamsha": {
    group: "Engine",
    label: "Ayanamsha",
    description_en:
      "Sidereal zodiac offset used by every calculation — changes recalculate all outputs.",
    type: "enum",
    allowed: ENGINE_CONFIG_ALLOWED.ayanamsha,
    capability: "settings.engine",
    public: true,
  },
  "public.engine_month_system": {
    group: "Engine",
    label: "Month system",
    description_en: "Lunar month convention for panchang/monthly boundaries.",
    type: "enum",
    allowed: ENGINE_CONFIG_ALLOWED.month_system,
    capability: "settings.engine",
    public: true,
  },
  "public.engine_house_system": {
    group: "Engine",
    label: "House system",
    description_en: "House division rule used when drawing charts.",
    type: "enum",
    allowed: ENGINE_CONFIG_ALLOWED.house_system,
    capability: "settings.engine",
    public: true,
  },
  "public.engine_chart_style": {
    group: "Engine",
    label: "Chart style",
    description_en: "Visual chart tradition: north/south Indian diamond house layout.",
    type: "enum",
    allowed: ENGINE_CONFIG_ALLOWED.chart_style,
    capability: "settings.engine",
    public: true,
  },
};

/**
 * The defensive engine prefix. The REAL keys are public.engine_ayanamsha etc.
 * — underscore after "engine", never a dot (seed 0005; phase-4 story [P0]
 * fix + [R10]). The per-key registry capability is the primary gate; this
 * prefix check is the belt-and-braces for any future engine key.
 */
export const ENGINE_KEY_PREFIX = "public.engine_";

export function isEngineKey(key: string): boolean {
  return key.startsWith(ENGINE_KEY_PREFIX);
}

/** Registry definition for a key, or null when the key is unknown. */
export function registryDef(key: string): SettingDef | null {
  return Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key)
    ? (SETTINGS_REGISTRY[key] ?? null)
    : null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Serialized size ceiling for json settings ([P2] review follow-up) — these
 * keys are served on the PUBLIC /settings endpoint, so an unbounded payload
 * would ride every public request. 64 KB is generous for nav/home/offers
 * (the nav validator's own shape caps top out around 150 KB of worst case,
 * but real configs are a few KB).
 */
const JSON_VALUE_MAX_CHARS = 65536;

export type ValueCheck = { ok: true } | { ok: false; message: string };

/**
 * Validate a decoded JSONB value against the registry entry. jsonb values
 * from PostgREST arrive decoded (strings are strings, objects are objects),
 * so type checks are direct. json type accepts any JSON value up to the
 * size ceiling — structural contracts (NavTab) are enforced by their
 * dedicated routes AND re-checked by the generic PUT for public.nav_config.
 */
export function checkSettingValue(def: SettingDef, value: unknown): ValueCheck {
  switch (def.type) {
    case "json": {
      let serialized = "";
      try {
        serialized = JSON.stringify(value) ?? "";
      } catch {
        return { ok: false, message: "must be a JSON-serialisable value" };
      }
      return serialized.length <= JSON_VALUE_MAX_CHARS
        ? { ok: true }
        : { ok: false, message: `JSON value too large (max ${JSON_VALUE_MAX_CHARS} chars)` };
    }
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true }
        : { ok: false, message: "must be true or false" };
    case "enum":
      return typeof value === "string" && def.allowed?.includes(value)
        ? { ok: true }
        : { ok: false, message: `must be one of: ${def.allowed?.join(", ")}` };
    case "date":
      // regex shape AND a real calendar check ([P3] review follow-up —
      // "2026-13-45" matches the regex but is not a date)
      return typeof value === "string" &&
        ISO_DATE_RE.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        ? { ok: true }
        : { ok: false, message: "must be a YYYY-MM-DD date" };
    case "email":
      return typeof value === "string" && value.length <= 320 && EMAIL_RE.test(value)
        ? { ok: true }
        : { ok: false, message: "must be an email address" };
    case "url":
      try {
        if (typeof value !== "string") throw new Error("not a string");
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:"
          ? { ok: true }
          : { ok: false, message: "must be an http(s) URL" };
      } catch {
        return { ok: false, message: "must be an http(s) URL" };
      }
    case "string":
    default:
      return typeof value === "string" && value.length <= 500
        ? { ok: true }
        : { ok: false, message: "must be a string of at most 500 chars" };
  }
}

/** Groups in a stable display order, as they appear in the registry. */
export function registryGroups(): string[] {
  const seen: string[] = [];
  for (const def of Object.values(SETTINGS_REGISTRY)) {
    if (!seen.includes(def.group)) seen.push(def.group);
  }
  return seen;
}
