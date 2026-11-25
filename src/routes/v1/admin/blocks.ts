/**
 * Epic 4.2b — admin CRUD for the `content_blocks` store (same table that
 * backs /content/home, public-read for published rows via RLS). This gives
 * the kundli interpretation notes (block_key prefix "kundli.") — and any
 * future keyed block surface — an authoring path: the admin UI lists,
 * upserts and deletes blocks per (block_key, lang). Keys are flat
 * namespaced strings ("kundli.lagna"); payloads are JSONB objects.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { writeAudit } from "../../../lib/audit";
import { rest, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminBlocksRoute = new Hono<Env>();

const KEY_RE = /^[a-z0-9_.-]{1,80}$/;
const LANGS = ["en", "hi"];
const STATUSES = ["draft", "published"];

function credsMissing(c: any) {
  return c.json(
    {
      error: {
        code: "service_unavailable",
        message: "Admin endpoints require backend auth credentials.",
      },
    },
    503,
  );
}

adminBlocksRoute.get("/admin/content-blocks", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const prefix = c.req.query("prefix");
  const filter = prefix ? `&block_key=like.${encodeURIComponent(prefix)}*` : "";
  const res = await rest(
    creds,
    `content_blocks?select=block_key,lang,status,is_sample,updated_at,payload&order=block_key.asc,lang.asc&limit=500${filter}`,
  );
  if (!res.ok)
    return c.json(
      { error: { code: "internal_error", message: "Content blocks read failed" } },
      500,
    );
  return c.json({ data: { blocks: await res.json() } });
});

adminBlocksRoute.put("/admin/content-blocks/:key", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const key = c.req.param("key");
  if (!KEY_RE.test(key)) {
    return c.json(
      { error: { code: "validation_error", message: "key must be 1–80 chars of a-z 0-9 . _ -" } },
      400,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    lang?: unknown;
    status?: unknown;
    payload?: unknown;
  };
  const lang = body.lang === undefined ? "en" : body.lang;
  if (!LANGS.includes(lang as string)) {
    return c.json({ error: { code: "validation_error", message: "lang must be en or hi" } }, 400);
  }
  const status = body.status === undefined ? "published" : body.status;
  if (!STATUSES.includes(status as string)) {
    return c.json(
      { error: { code: "validation_error", message: "status must be draft or published" } },
      400,
    );
  }
  if (
    body.payload === undefined ||
    body.payload === null ||
    typeof body.payload !== "object" ||
    Array.isArray(body.payload)
  ) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "payload is required and must be a JSON object",
        },
      },
      400,
    );
  }
  const res = await rest(creds, "content_blocks?on_conflict=block_key,lang", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([
      { block_key: key, lang, status, payload: body.payload, updated_at: new Date().toISOString() },
    ]),
  });
  if (!res.ok)
    return c.json(
      { error: { code: "internal_error", message: "Content block write failed" } },
      500,
    );
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const blockId = typeof rows[0]?.id === "string" ? (rows[0]?.id as string) : key;
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "content_blocks.update",
    entity: "content_blocks",
    entity_id: blockId,
    details: {
      block_key: key,
      lang,
      status,
      payload_keys: Object.keys((body.payload ?? {}) as Record<string, unknown>).slice(0, 25),
    },
  });
  return c.json({ data: rows[0] ?? { block_key: key, lang, status, payload: body.payload } });
});

adminBlocksRoute.delete("/admin/content-blocks/:key", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const key = c.req.param("key");
  if (!KEY_RE.test(key)) {
    return c.json(
      { error: { code: "validation_error", message: "key must be 1–80 chars of a-z 0-9 . _ -" } },
      400,
    );
  }
  const lang = c.req.query("lang") ?? "en";
  if (!LANGS.includes(lang)) {
    return c.json({ error: { code: "validation_error", message: "lang must be en or hi" } }, 400);
  }
  const res = await rest(
    creds,
    `content_blocks?block_key=eq.${encodeURIComponent(key)}&lang=eq.${lang}`,
    { method: "DELETE" },
  );
  if (!res.ok)
    return c.json(
      { error: { code: "internal_error", message: "Content block delete failed" } },
      500,
    );
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "content_blocks.delete",
    entity: "content_blocks",
    entity_id: key,
    details: { lang },
  });
  return c.json({ data: { block_key: key, lang, deleted: true } });
});
