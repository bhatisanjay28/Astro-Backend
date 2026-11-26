/**
 * Epic 6.1 — Admin API root. All /api/v1/admin/* routes are guarded by
 * requireAdmin (Supabase Auth bearer token + admin_users role row).
 *
 * Admin Phase 1 adds authorization layers:
 *  - requireAdmin(): identity + is_active + token-age cap (auth boundary);
 *  - requireCapabilityFor(...): per-subtree method → capability map
 *    (02-mary-gap-analysis §C, enforced server-side — never just hidden UI);
 *  - every mutating route writes the audit trail (lib/audit.ts).
 *
 * GET /admin/me — identity + role + capabilities probe used by the admin UI.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../env";
import { requireAdmin, requireCapability, requireCapabilityFor } from "../../lib/admin-auth";
import { adminAuditRoute } from "./admin/audit";
import { adminBlocksRoute } from "./admin/blocks";
import { adminCatalogRoute } from "./admin/catalog";
import { adminHoroscopesRoute } from "./admin/horoscopes";
import { adminInboxRoute } from "./admin/inbox";
import { adminMediaRoute } from "./admin/media";
import { adminOpsRoute } from "./admin/ops";
import { adminPostsRoute } from "./admin/posts";
import { adminStatsRoute } from "./admin/stats";
import { adminTaxonomyRoute } from "./admin/taxonomy";
import { adminUsersRoute } from "./admin/users";

export const adminRoute = new Hono<AppEnvWithAdmin>();

adminRoute.use("/admin/*", requireAdmin());

// --- capability maps (method → capability), declared per subtree ------------
const WRITE_POSTS = { POST: "posts.write", PUT: "posts.write", DELETE: "posts.write" } as const;
const WRITE_BLOCKS = { PUT: "blocks.write", DELETE: "blocks.write" } as const;
const WRITE_TAXONOMY = {
  POST: "taxonomy.write",
  PUT: "taxonomy.write",
  DELETE: "taxonomy.write",
} as const;
const WRITE_CATALOG = {
  POST: "catalog.write",
  PATCH: "catalog.write",
  DELETE: "catalog.write",
} as const;
const WRITE_HORIZON = {
  POST: "horoscope.write",
  PATCH: "horoscope.write",
  // phase 4 [R8]: dropping a horoscope row is irreversible → its own
  // capability, held by admin+ but NOT content_editor (rbac.ts)
  DELETE: "horoscope.delete",
} as const;
const WRITE_INBOX = { PATCH: "inbox.write", POST: "inbox.write", DELETE: "inbox.write" } as const;
// phase 4 — newsletter subscribers + the unified catalog routes
const SUBSCRIBER_MAP = {
  GET: "newsletter.read",
  PATCH: "newsletter.write",
  DELETE: "newsletter.delete", // DPDP erase — super_admin + admin only
} as const;
// /admin/catalog/* carries POST /admin/catalog/reorder today; PATCH/DELETE
// are pinned so any future mutating route under this subtree inherits
// catalog.write instead of requireCapabilityFor's requireAdmin default for
// unmapped methods (review [P3]).
const CATALOG_MAP = {
  GET: "catalog.read",
  POST: "catalog.write",
  PATCH: "catalog.write",
  DELETE: "catalog.write",
} as const;

adminRoute.use("/admin/posts", requireCapabilityFor({ GET: "posts.read", ...WRITE_POSTS }));
adminRoute.use("/admin/posts/*", requireCapabilityFor({ GET: "posts.read", ...WRITE_POSTS }));
adminRoute.use(
  "/admin/content-blocks",
  requireCapabilityFor({ GET: "blocks.read", ...WRITE_BLOCKS }),
);
adminRoute.use(
  "/admin/content-blocks/*",
  requireCapabilityFor({ GET: "blocks.read", ...WRITE_BLOCKS }),
);
adminRoute.use(
  "/admin/categories",
  requireCapabilityFor({ GET: "taxonomy.read", ...WRITE_TAXONOMY }),
);
adminRoute.use(
  "/admin/categories/*",
  requireCapabilityFor({ GET: "taxonomy.read", ...WRITE_TAXONOMY }),
);
adminRoute.use("/admin/tags", requireCapabilityFor({ GET: "taxonomy.read", ...WRITE_TAXONOMY }));
adminRoute.use("/admin/tags/*", requireCapabilityFor({ GET: "taxonomy.read", ...WRITE_TAXONOMY }));
adminRoute.use("/admin/media", requireCapabilityFor({ GET: "media.read", POST: "media.write" }));
adminRoute.use(
  "/admin/media/*",
  requireCapabilityFor({ GET: "media.read", DELETE: "media.delete" }),
);
adminRoute.use(
  "/admin/astrologers",
  requireCapabilityFor({ GET: "catalog.read", ...WRITE_CATALOG }),
);
adminRoute.use(
  "/admin/astrologers/*",
  requireCapabilityFor({ GET: "catalog.read", ...WRITE_CATALOG }),
);
adminRoute.use("/admin/pujas", requireCapabilityFor({ GET: "catalog.read", ...WRITE_CATALOG }));
adminRoute.use("/admin/pujas/*", requireCapabilityFor({ GET: "catalog.read", ...WRITE_CATALOG }));
adminRoute.use(
  "/admin/horoscopes",
  requireCapabilityFor({ GET: "horoscope.read", ...WRITE_HORIZON }),
);
adminRoute.use(
  "/admin/horoscopes/*",
  requireCapabilityFor({ GET: "horoscope.read", ...WRITE_HORIZON }),
);
adminRoute.use("/admin/requests", requireCapabilityFor({ GET: "inbox.read", ...WRITE_INBOX }));
adminRoute.use("/admin/requests/*", requireCapabilityFor({ GET: "inbox.read", ...WRITE_INBOX }));
adminRoute.use("/admin/messages", requireCapabilityFor({ GET: "inbox.read", ...WRITE_INBOX }));
adminRoute.use("/admin/messages/*", requireCapabilityFor({ GET: "inbox.read", ...WRITE_INBOX }));
adminRoute.use("/admin/subscribers", requireCapabilityFor({ ...SUBSCRIBER_MAP }));
adminRoute.use("/admin/subscribers/*", requireCapabilityFor({ ...SUBSCRIBER_MAP }));
adminRoute.use("/admin/catalog", requireCapabilityFor({ ...CATALOG_MAP }));
adminRoute.use("/admin/catalog/*", requireCapabilityFor({ ...CATALOG_MAP }));

// super_admin-only + audit-read + dashboard-stats gates (registered before
// the mounts so they run ahead of the handlers; both patterns so subpaths
// are covered).
const usersOnly = requireCapability("users.manage");
const auditRead = requireCapability("audit.read");
const statsRead = requireCapability("stats.read");
adminRoute.use("/admin/users", usersOnly);
adminRoute.use("/admin/users/*", usersOnly);
adminRoute.use("/admin/audit", auditRead);
adminRoute.use("/admin/stats", statsRead);

adminRoute.route("/", adminPostsRoute);
adminRoute.route("/", adminBlocksRoute);
adminRoute.route("/", adminTaxonomyRoute);
adminRoute.route("/", adminMediaRoute);
adminRoute.route("/", adminCatalogRoute);
adminRoute.route("/", adminHoroscopesRoute);
adminRoute.route("/", adminInboxRoute);
adminRoute.route("/", adminOpsRoute);
adminRoute.route("/", adminUsersRoute);
adminRoute.route("/", adminAuditRoute);
adminRoute.route("/", adminStatsRoute);

adminRoute.get("/admin/me", (c) => {
  const admin = c.get("admin");
  return c.json({
    data: {
      user_id: admin.userId,
      email: admin.email,
      role: admin.role,
      display_name: admin.display_name,
      is_active: admin.is_active,
      /** authenticator assurance level of the presenting token (MFA readiness) */
      aal: admin.aal,
      /** role capabilities — for UI affordances only; the API remains the gate */
      capabilities: admin.capabilities,
    },
  });
});
