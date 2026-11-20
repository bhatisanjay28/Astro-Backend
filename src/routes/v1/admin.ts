/**
 * Epic 6.1 — Admin API root. All /api/v1/admin/* routes are guarded by
 * requireAdmin (Supabase Auth bearer token + admin_users role row).
 *
 * GET /admin/me — identity + role probe used by the admin UI to decide what
 * the signed-in user may see; also the live smoke test for the auth plumbing.
 *
 * Later stories mount here: 6.2 post CRUD, 6.4 admin modules
 * (horoscope content, astrologers, poojas, requests inbox, settings).
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../env";
import { requireAdmin } from "../../lib/admin-auth";
import { adminBlocksRoute } from "./admin/blocks";
import { adminCatalogRoute } from "./admin/catalog";
import { adminHoroscopesRoute } from "./admin/horoscopes";
import { adminInboxRoute } from "./admin/inbox";
import { adminMediaRoute } from "./admin/media";
import { adminOpsRoute } from "./admin/ops";
import { adminPostsRoute } from "./admin/posts";
import { adminTaxonomyRoute } from "./admin/taxonomy";

export const adminRoute = new Hono<AppEnvWithAdmin>();

adminRoute.use("/admin/*", requireAdmin());

adminRoute.route("/", adminPostsRoute);
adminRoute.route("/", adminBlocksRoute);
adminRoute.route("/", adminTaxonomyRoute);
adminRoute.route("/", adminMediaRoute);
adminRoute.route("/", adminCatalogRoute);
adminRoute.route("/", adminHoroscopesRoute);
adminRoute.route("/", adminInboxRoute);
adminRoute.route("/", adminOpsRoute);

adminRoute.get("/admin/me", (c) => {
  const admin = c.get("admin");
  return c.json({
    data: {
      user_id: admin.userId,
      email: admin.email,
      role: admin.role,
      /** authenticator assurance level of the presenting token (MFA readiness) */
      aal: admin.aal,
    },
  });
});
