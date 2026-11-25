/**
 * Epic 6.2 — Post domain helpers (pure functions, unit-testable without HTTP).
 *
 * Schedule model (migration 0001 constraint: status ∈ draft|published|archived):
 * a scheduled post is a DRAFT with a future `publish_at`. Publication flips
 * lazily — every admin/public listing sweeps due drafts to published, so no
 * cron dependency and public reads never see an un-due draft.
 *
 * Sanitisation note: content_md is sanitised on SAVE (sanitizeMarkdown below —
 * owner brief: "sanitise Markdown on save as well as on render"; pre-commit
 * review P2) AND at render time (public blog, Epic 6.3 — rehype-sanitize over
 * Astro's markdown pipeline). Only admin_users can write posts (Epic 6.1),
 * which is the first gate; the render-time sanitiser is the last.
 */

export const POST_STATUSES = ["draft", "published", "archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Save-time HTML scrub for Markdown sources. Strips the dangerous raw-HTML
 * subset — scriptable/executable tags, on* event-handler attributes and
 * javascript:/vbscript: URLs — while leaving all normal Markdown (code
 * fences, benign inline HTML like <b>, links, tables) untouched. The render
 * pipeline keeps its own rehype-sanitize pass as the second layer.
 */
const SCRIPTABLE_ELEMENT = /<\s*(script|iframe)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const SCRIPTABLE_TAG = /<\s*\/?\s*(script|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi;
const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL =
  /(\s(?:href|src)\s*=\s*)(?:"\s*(?:javascript|vbscript)\s*:[^"]*"|'\s*(?:javascript|vbscript)\s*:[^']*'|(?:javascript|vbscript)\s*:[^\s>]*)/gi;

export function sanitizeMarkdown(md: string): string {
  return md
    .replace(SCRIPTABLE_ELEMENT, "") // element AND its inline JS body
    .replace(SCRIPTABLE_TAG, "")
    .replace(EVENT_ATTR, "")
    .replace(DANGEROUS_URL, '$1"#"');
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
}

/** Auto reading time: ~200 wpm, minimum 1. */
export function readingMinutes(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export type PostInput = {
  title?: unknown;
  slug?: unknown;
  content_md?: unknown;
  excerpt?: unknown;
  status?: unknown;
  publish_at?: unknown;
  category?: unknown;
  tags?: unknown;
  featured_image_url?: unknown;
  alt_text?: unknown;
  seo_title?: unknown;
  seo_description?: unknown;
  canonical_url?: unknown;
  og_image_url?: unknown;
};

export type ValidationError = { field: string; message: string };

const URL_RE = /^https?:\/\/\S+$/;

/** Validate create/update payload. Returns the clean fields or the error list. */
export function validatePostInput(
  input: PostInput,
  mode: "create" | "update",
): { ok: true; fields: Record<string, unknown> } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const fields: Record<string, unknown> = {};

  if (input.title !== undefined || mode === "create") {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title.length < 1 || title.length > 200) {
      errors.push({ field: "title", message: "title is required (1–200 characters)" });
    } else {
      fields.title = title;
    }
  }

  if (input.slug !== undefined) {
    const slug = typeof input.slug === "string" ? input.slug.trim() : "";
    if (slug && !SLUG_RE.test(slug)) {
      errors.push({
        field: "slug",
        message: "slug must be lowercase letters/numbers separated by single hyphens",
      });
    } else if (slug) {
      fields.slug = slug;
    }
  }

  if (input.content_md !== undefined || mode === "create") {
    const md = typeof input.content_md === "string" ? input.content_md : "";
    if (md.trim().length < 1 || md.length > 100_000) {
      errors.push({
        field: "content_md",
        message: "content_md is required (1–100,000 characters)",
      });
    } else {
      // sanitise on save — create AND update both flow through here
      fields.content_md = sanitizeMarkdown(md);
    }
  }

  if (input.excerpt !== undefined) {
    const ex = typeof input.excerpt === "string" ? input.excerpt.trim() : "";
    if (ex.length > 500) {
      errors.push({ field: "excerpt", message: "excerpt must be ≤ 500 characters" });
    } else {
      fields.excerpt = ex || null;
    }
  }

  let status: PostStatus | undefined;
  if (input.status !== undefined) {
    const s = typeof input.status === "string" ? input.status : "";
    if (!POST_STATUSES.includes(s as PostStatus)) {
      errors.push({ field: "status", message: "status must be draft, published or archived" });
    } else {
      status = s as PostStatus;
      fields.status = status;
    }
  } else if (mode === "create") {
    status = "draft";
    fields.status = "draft";
  }

  if (input.publish_at !== undefined && input.publish_at !== null) {
    const ts = typeof input.publish_at === "string" ? input.publish_at : "";
    const date = new Date(ts);
    if (!ts || Number.isNaN(date.getTime())) {
      errors.push({ field: "publish_at", message: "publish_at must be an ISO 8601 timestamp" });
    } else {
      fields.publish_at = date.toISOString();
    }
  }

  // Scheduling semantics: published + future publish_at is contradictory —
  // callers schedule by sending status draft with a future publish_at.
  if (
    status === "published" &&
    fields.publish_at !== undefined &&
    typeof fields.publish_at === "string" &&
    new Date(fields.publish_at).getTime() > Date.now() + 5_000
  ) {
    errors.push({
      field: "publish_at",
      message: "cannot publish with a future publish_at — send status draft to schedule",
    });
  }

  for (const [key, maxLen] of [
    ["seo_title", 200],
    ["seo_description", 500],
    ["alt_text", 300],
  ] as const) {
    if (input[key] !== undefined) {
      const v = typeof input[key] === "string" ? (input[key] as string).trim() : "";
      if (v.length > maxLen) {
        errors.push({ field: key, message: `${key} must be ≤ ${maxLen} characters` });
      } else {
        fields[key] = v || null;
      }
    }
  }

  for (const key of ["featured_image_url", "canonical_url", "og_image_url"] as const) {
    if (input[key] !== undefined) {
      const v = typeof input[key] === "string" ? (input[key] as string).trim() : "";
      if (v && !URL_RE.test(v)) {
        errors.push({ field: key, message: `${key} must be an http(s) URL` });
      } else {
        fields[key] = v || null;
      }
    }
  }

  if (input.category !== undefined) {
    const slug = typeof input.category === "string" ? input.category.trim() : "";
    if (slug && !SLUG_RE.test(slug)) {
      errors.push({ field: "category", message: "category must be a category slug" });
    } else {
      fields.category = slug || null;
    }
  }

  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 10) {
      errors.push({ field: "tags", message: "tags must be an array of at most 10 slugs" });
    } else {
      const tags = (input.tags as unknown[]).map((t) => (typeof t === "string" ? t.trim() : ""));
      if (tags.some((t) => !SLUG_RE.test(t))) {
        errors.push({ field: "tags", message: "each tag must be a lowercase slug" });
      } else {
        fields.tags = [...new Set(tags)];
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}

/**
 * Allowed status transitions (editorial flow). Anything else → rejected with
 * an explanation rather than silently applied.
 */
const TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  draft: ["draft", "published", "archived"],
  published: ["published", "draft", "archived"],
  archived: ["archived", "published"],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
