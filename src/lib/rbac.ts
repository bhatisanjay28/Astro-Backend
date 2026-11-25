/**
 * Admin Phase 1 — capability-based RBAC (single source of truth).
 *
 * Design of record: _bmad-output/admin/03-winston-architecture.md §1–2;
 * permission matrix: _bmad-output/admin/02-mary-gap-analysis.md §C.
 *
 * Roles live in admin_users.role (migration 0014 widened the CHECK). This
 * module maps role → capabilities; routes declare the capability they need
 * and requireCapability enforces it. RLS (migration 0014) enforces only
 * coarse floors — fine-grained control is here, in the backend, which is
 * the real boundary (D3).
 *
 * Fail-safe: unknown/legacy roles map to NO capabilities.
 */

export const ADMIN_ROLES = [
  "super_admin",
  "admin",
  "content_editor",
  "booking_manager",
  "viewer",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const CAPABILITIES = [
  "stats.read",
  "users.manage",
  "audit.read",
  // blog
  "posts.read",
  "posts.write",
  "posts.publish",
  "posts.purge",
  "taxonomy.read",
  "taxonomy.write",
  "tags.merge",
  "media.read",
  "media.write",
  "media.delete",
  "blocks.read",
  "blocks.write",
  // horoscope content
  "horoscope.read",
  "horoscope.write",
  "horoscope.regenerate",
  // astrologers & poojas
  "catalog.read",
  "catalog.write",
  // inbox (requests + messages)
  "inbox.read",
  "inbox.write",
  "inbox.read_pii",
  "inbox.export",
  // settings & site
  "settings.read",
  "settings.write",
  "settings.engine",
  "nav.write",
  // newsletter subscribers
  "newsletter.read",
  "newsletter.write",
  "newsletter.export",
  "newsletter.delete",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const EDITOR_TIER: readonly Capability[] = [
  "stats.read",
  "audit.read",
  "posts.read",
  "posts.write",
  "posts.publish", // owner decision D1: content_editor may publish (tighten later if a review gate is wanted)
  "taxonomy.read",
  "taxonomy.write",
  "media.read",
  "media.write",
  "media.delete",
  "blocks.read",
  "blocks.write",
  "horoscope.read",
  "horoscope.write",
  "nav.write",
];

/** Role → capabilities. Order matters only for readability. */
export const ROLE_CAPABILITIES: Record<AdminRole, readonly Capability[]> = {
  super_admin: CAPABILITIES,
  admin: CAPABILITIES.filter((cap) => cap !== "users.manage" && cap !== "settings.engine"),
  content_editor: EDITOR_TIER,
  booking_manager: [
    "stats.read",
    "audit.read",
    "catalog.read",
    "catalog.write",
    "inbox.read",
    "inbox.write",
    "inbox.read_pii",
    "inbox.export",
    "newsletter.read",
    "newsletter.write",
    "newsletter.export",
  ],
  viewer: ["stats.read", "inbox.read", "horoscope.read"],
};

/** True when the role holds the capability. Unknown roles never do (fail-safe). */
export function roleCan(role: string, capability: Capability): boolean {
  const caps = ROLE_CAPABILITIES[role as AdminRole];
  return Array.isArray(caps) && caps.includes(capability);
}

/** Capabilities for a role — used by GET /admin/me so the UI can hide (never as the gate). */
export function capabilitiesOf(role: string): Capability[] {
  const caps = ROLE_CAPABILITIES[role as AdminRole];
  return Array.isArray(caps) ? [...caps] : [];
}
