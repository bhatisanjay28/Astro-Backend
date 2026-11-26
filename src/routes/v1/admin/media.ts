/**
 * Epic 6.2 — Media upload for post images (PRD §2: storage = Supabase Storage).
 * Raw-bytes upload: POST /api/v1/admin/media?filename=x.png&alt=alt+text
 * with the image bytes as the body and a proper Content-Type header.
 *
 * Stored in the public "media" bucket (auto-created on first upload), path
 * yyyy-mm/<random>-<name>.<ext> to avoid collisions; every upload is recorded
 * in the `media` table (migration 0001) and the public URL returned.
 *
 * SVG is deliberately rejected (scriptable → stored XSS vector via public URL).
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { writeAudit } from "../../../lib/audit";
import { slugify } from "../../../lib/posts";
import { roleCan } from "../../../lib/rbac";
import { safeQuery } from "../../../lib/safe-query";
import { rest, restList, type SupabaseCreds, storage, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminMediaRoute = new Hono<Env>();

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "media";

/** True when the bytes' magic number matches the declared image mime — a
 * renamed file that lies about its Content-Type is rejected before it can
 * reach the public bucket (owner brief: validate uploads "type, size,
 * content"; pre-commit review P2). */
function matchesMagic(mime: string, b: Uint8Array): boolean {
  const starts = (...sig: number[]): boolean => sig.every((v, i) => b[i] === v);
  const at = (offset: number, ...sig: number[]): boolean =>
    sig.every((v, i) => b[offset + i] === v);
  switch (mime) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38); // "GIF8" (87a/89a)
    case "image/webp":
      // "RIFF" at 0..3, "WEBP" at 8..11
      return starts(0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
    default:
      return false;
  }
}

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

async function ensureBucket(creds: SupabaseCreds): Promise<boolean> {
  const res = await storage(creds, `bucket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: BUCKET, public: true }),
  });
  // 200 created · 409 already exists — both fine.
  return res.ok || res.status === 409;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where is this media object used? Posts reference images by full public URL
 * in featured_image_url / og_image_url and by path inside content_md. One
 * or= scan per object — deliberately NOT filtered on deleted_at: an image
 * referenced by a trashed post is still recoverable data and must not be
 * hard-deleted silently (story [R7]).
 */
async function usageCount(
  creds: SupabaseCreds,
  publicUrl: string,
  objectPath: string,
): Promise<number> {
  const or = `or=(featured_image_url.eq.${publicUrl},og_image_url.eq.${publicUrl},content_md.like.*${objectPath}*)`;
  const res = await restList(creds, `blog_posts?${or}&select=id`);
  if (!res.ok) return -1; // scan failed → caller must not claim "unused"
  return res.total;
}

adminMediaRoute.post("/admin/media", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);

  const q = c.req.query();
  const filename = (q.filename ?? "").trim();
  const alt = (q.alt ?? "").trim();
  const mime = (c.req.header("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (!filename) {
    return c.json(
      { error: { code: "validation_error", message: "filename query parameter is required" } },
      400,
    );
  }
  if (!ALLOWED_MIME.has(mime)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "only png, jpeg, webp or gif images are accepted (SVG is not allowed)",
        },
      },
      400,
    );
  }
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json(
      { error: { code: "validation_error", message: "empty body — send the image bytes" } },
      400,
    );
  }
  if (bytes.byteLength > MAX_BYTES) {
    return c.json({ error: { code: "validation_error", message: "image must be ≤ 5 MB" } }, 400);
  }
  // Content check: declared type must match the file's magic bytes (a text
  // file renamed .png must not enter the public bucket as an image).
  if (!matchesMagic(mime, new Uint8Array(bytes))) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "file content does not match its declared image type",
        },
      },
      415,
    );
  }
  // Alt text is required (a11y + SEO — Mary's media audit item).
  if (!alt) {
    return c.json(
      { error: { code: "validation_error", message: "alt query parameter is required" } },
      400,
    );
  }

  const base = slugify(filename.replace(/\.[a-z0-9]+$/i, "")) || "image";
  const now = new Date();
  const folder = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const objectPath = `${folder}/${now.getTime().toString(36)}-${base}.${EXT_BY_MIME[mime]}`;

  let res = await storage(creds, `object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { "Content-Type": mime, "x-upsert": "false" },
    body: bytes,
  });
  // Bucket missing (first ever upload) → create it, retry once.
  if (res.status === 404 || res.status === 400) {
    if (await ensureBucket(creds)) {
      res = await storage(creds, `object/${BUCKET}/${objectPath}`, {
        method: "POST",
        headers: { "Content-Type": mime, "x-upsert": "false" },
        body: bytes,
      });
    }
  }
  if (!res.ok) {
    return c.json(
      { error: { code: "internal_error", message: `Storage upload failed: ${res.status}` } },
      500,
    );
  }

  const record = {
    owner_id: c.get("admin").userId,
    bucket: BUCKET,
    path: objectPath,
    mime,
    size_bytes: bytes.byteLength,
    alt,
  };
  const dbRes = await rest(creds, "media", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(record),
  });
  if (!dbRes.ok) {
    return c.json(
      { error: { code: "internal_error", message: "Media record insert failed" } },
      500,
    );
  }
  const insertedRows = (await dbRes.json()) as Array<{ id: string }>;
  const row = insertedRows[0];
  if (!row) {
    return c.json(
      { error: { code: "internal_error", message: "Media record insert returned no row" } },
      500,
    );
  }
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "media.upload",
    entity: "media",
    entity_id: row.id,
    details: {
      filename: filename.slice(0, 120),
      path: objectPath,
      mime,
      size_bytes: bytes.byteLength,
    },
  });
  const publicUrl = `${creds.url}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  return c.json(
    {
      data: {
        id: row.id,
        url: publicUrl,
        path: objectPath,
        mime,
        size_bytes: bytes.byteLength,
        alt: record.alt,
      },
    },
    201,
  );
});

adminMediaRoute.get("/admin/media", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const q = safeQuery(c.req.query("q"));
  const filter = q
    ? `&or=(path.ilike.*${encodeURIComponent(q)}*,alt.ilike.*${encodeURIComponent(q)}*)`
    : "";
  const res = await rest(
    creds,
    `media?select=id,bucket,path,mime,size_bytes,alt,created_at&order=created_at.desc&limit=50${filter}`,
  );
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Media listing failed" } }, 500);
  }
  const rows = (await res.json()) as Array<{ id: string; bucket: string; path: string }>;
  // Per-row usage so the grid can grey out referenced images before anyone
  // reaches for the delete button (story [R7]).
  const items = await Promise.all(
    rows.map(async (r) => {
      const url = `${creds.url}/storage/v1/object/public/${r.bucket}/${r.path}`;
      return { ...r, url, used_in: await usageCount(creds, url, r.path) };
    }),
  );
  return c.json({ data: { items } });
});

/**
 * DELETE /admin/media/:id — removes the storage object AND its row.
 * Referenced images 409 with {used_in:n}; `?force=true` overrides that but
 * needs `media.force_delete` (super_admin/admin — content_editor's
 * media.delete covers orphan cleanup only, story [R4]). The object's data
 * is the URL posts embed, so this is irreversible; audited with the path.
 */
adminMediaRoute.delete("/admin/media/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: { code: "not_found", message: "Media object not found" } }, 404);
  }
  const admin = c.get("admin");

  const existingRes = await rest(
    creds,
    `media?id=eq.${encodeURIComponent(id)}&select=id,bucket,path,mime,size_bytes,alt&limit=1`,
  );
  if (!existingRes.ok) {
    return c.json({ error: { code: "internal_error", message: "Media lookup failed" } }, 500);
  }
  const row = (
    (await existingRes.json()) as Array<{
      id: string;
      bucket: string;
      path: string;
      mime: string;
      size_bytes: number;
      alt: string | null;
    }>
  )[0];
  if (!row) {
    return c.json({ error: { code: "not_found", message: "Media object not found" } }, 404);
  }

  const publicUrl = `${creds.url}/storage/v1/object/public/${row.bucket}/${row.path}`;
  const usedIn = await usageCount(creds, publicUrl, row.path);
  if (usedIn < 0) {
    return c.json(
      { error: { code: "internal_error", message: "Usage scan failed — delete refused" } },
      500,
    );
  }
  const force = c.req.query("force") === "true";
  if (usedIn > 0) {
    if (!force) {
      return c.json(
        {
          error: {
            code: "conflict",
            message: `this image is used by ${usedIn} post${usedIn === 1 ? "" : "s"} — remove the references or pass force=true`,
            used_in: usedIn,
          },
        },
        409,
      );
    }
    // force path: sharper capability, checked here (subtree DELETE maps to
    // media.delete which content_editor holds — story [R4])
    if (!roleCan(admin.role, "media.force_delete")) {
      return c.json(
        {
          error: {
            code: "forbidden",
            message: `Your role (${admin.role || "unknown"}) does not permit this action.`,
          },
        },
        403,
      );
    }
  }

  // Storage first (404 = already gone, fine), then the row — a failed
  // storage delete aborts before the record disappears.
  const obj = await storage(creds, `object/${row.bucket}/${row.path}`, { method: "DELETE" });
  if (!obj.ok && obj.status !== 404) {
    return c.json(
      { error: { code: "internal_error", message: `Storage delete failed: ${obj.status}` } },
      500,
    );
  }
  const rowRes = await rest(creds, `media?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!rowRes.ok) {
    return c.json(
      { error: { code: "internal_error", message: "Media record delete failed" } },
      500,
    );
  }
  if (((await rowRes.json()) as unknown[]).length === 0) {
    return c.json({ error: { code: "not_found", message: "Media object not found" } }, 404);
  }

  await writeAudit(creds, {
    actor: admin.userId,
    action: "media.delete",
    entity: "media",
    entity_id: id,
    details: { path: row.path, mime: row.mime, size_bytes: row.size_bytes, used_in: usedIn, force },
  });
  return c.json({ data: { id, deleted: true, used_in: usedIn, force } });
});
