import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Admin Phase 4 route tests — the catalog rewrite (soft delete / purge /
 * reorder / whitelists), the settings registry (engine P0 gate, per-key
 * capabilities), the nav editor (NavTab 1:1 validation + deploy hook),
 * subscribers (list / patch / DPDP delete) and the public gates ripple
 * (directory consent floors, requests deleted_at lookups).
 *
 * Identity/auth middleware is mocked; RATE_LIMIT_DISABLED opts the suites
 * out of the per-user admin buckets.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  RATE_LIMIT_DISABLED: true,
};

const originalFetch = globalThis.fetch;

function fakeJwt(): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "user-1", aal: "aal1" })}.sig`;
}
const TOKEN = fakeJwt();
const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
});
const post = (body: unknown): RequestInit =>
  authed({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (body: unknown): RequestInit =>
  authed({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const put = (body: unknown): RequestInit =>
  authed({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** PostgREST list response with a content-range header (restList reads it). */
const list = (rows: unknown[]) =>
  json(rows, 200, { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });

/** Identity middleware mock for an arbitrary admin role. */
const identityAs =
  (role: string): Handler =>
  (url) => {
    if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "admin@vyotish.com" });
    if (url.includes("/rest/v1/admin_users"))
      return json([{ user_id: "user-1", email: "admin@vyotish.com", role }]);
    return undefined;
  };

type Handler = (url: string, init?: RequestInit) => Response | undefined;

/** Mock ALL fetches (no host gate) so deploy-hook pings can be captured. */
function mockAll(handler: Handler) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    return handler(url, init ?? {}) ?? new Response("unmocked: " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const VALID_TAB = {
  label: "Consultations",
  label_hi: "परामर्श",
  href: "/consultations",
  description: "Find an astrologer and request a booking",
  icon: "support_agent",
  menu: [
    {
      title: "Directory",
      cols: 2,
      links: [{ label: "All astrologers", href: "/consultations", desc: "d", hi: "स" }],
    },
  ],
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------ settings registry ------------------------------ */

describe("GET /admin/settings (registry)", () => {
  it("hides engine values from role admin but keeps the registry", async () => {
    mockAll((url, init) => {
      if (url.includes("/rest/v1/site_settings?select=key,value,updated_at")) {
        return json([
          { key: "public.engine_ayanamsha", value: "lahiri", updated_at: "2026-11-20T00:00:00Z" },
          {
            key: "public.gemstones_site_url",
            value: "https://gems.example.com",
            updated_at: "2026-11-21T00:00:00Z",
          },
        ]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/settings", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        values: Record<string, unknown>;
        registry: Record<string, unknown>;
        groups: string[];
      };
    };
    expect(body.data.values["public.gemstones_site_url"]).toBe("https://gems.example.com");
    // [R9]: engine values hidden from a role without settings.engine…
    expect(body.data.values["public.engine_ayanamsha"]).toBeUndefined();
    // …but the registry itself still declares them (UI shows the group).
    expect(body.data.registry["public.engine_ayanamsha"]).toBeDefined();
    expect(body.data.groups).toContain("Engine");
  });

  it("shows engine values to super_admin", async () => {
    mockAll((url, init) => {
      if (url.includes("/rest/v1/site_settings?select=key,value,updated_at")) {
        return json([{ key: "public.engine_ayanamsha", value: "lahiri", updated_at: null }]);
      }
      return identityAs("super_admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/settings", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { values: Record<string, unknown> } };
    expect(body.data.values["public.engine_ayanamsha"]).toBe("lahiri");
  });

  it("403s for roles without settings.read", async () => {
    mockAll((url, init) => identityAs("content_editor")(url, init));
    const res = await app.request("/api/v1/admin/settings", authed(), BINDINGS);
    expect(res.status).toBe(403);
  });
});

describe("PUT /admin/settings/:key (per-key capability + validation)", () => {
  it("404s an unknown key", async () => {
    mockAll((url, init) => identityAs("super_admin")(url, init));
    const res = await app.request(
      "/api/v1/admin/settings/public.does_not_exist",
      put({ value: 1 }),
      BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("403s an engine key for role admin (P0 pin)", async () => {
    mockAll((url, init) => identityAs("admin")(url, init));
    const res = await app.request(
      "/api/v1/admin/settings/public.engine_house_system",
      put({ value: "south_indian" }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("accepts a valid engine value from super_admin", async () => {
    let row: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/site_settings?on_conflict=key") && init?.method === "POST") {
        row = (JSON.parse(init.body as string) as Array<Record<string, unknown>>)[0];
        return json([row], 201);
      }
      return identityAs("super_admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/settings/public.engine_house_system",
      put({ value: "whole_sign" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(row?.key).toBe("public.engine_house_system");
  });

  it("400s an out-of-enum engine value", async () => {
    mockAll((url, init) => identityAs("super_admin")(url, init));
    const res = await app.request(
      "/api/v1/admin/settings/public.engine_ayanamsha",
      put({ value: "sidrarius" }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { details: Array<{ field: string }> } };
    expect(body.error.details?.[0]?.field).toBe("value");
  });

  it("400s a javascript: URL for a url-typed key", async () => {
    mockAll((url, init) => identityAs("admin")(url, init));
    const res = await app.request(
      "/api/v1/admin/settings/public.gemstones_site_url",
      put({ value: "javascript:alert(1)" }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });

  it("gates the nav JSON key by nav.write (editor yes, booking_manager no)", async () => {
    let row: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/site_settings?on_conflict=key") && init?.method === "POST") {
        row = (JSON.parse(init.body as string) as Array<Record<string, unknown>>)[0];
        return json([row], 201);
      }
      return identityAs("content_editor")(url, init);
    });
    const ok = await app.request(
      "/api/v1/admin/settings/public.nav_config",
      put({ value: [] }),
      BINDINGS,
    );
    expect(ok.status).toBe(200);
    expect(row?.key).toBe("public.nav_config");

    // generic-path validator ([P1] review fix): the NavTab shape check also
    // applies through /admin/settings/:key — a javascript: href must not
    // bypass isNavHref via the back door
    const bad = await app.request(
      "/api/v1/admin/settings/public.nav_config",
      put({
        value: [
          {
            label: "Evil",
            label_hi: "इविल",
            href: "javascript:alert(1)",
            description: "x",
            icon: "star",
          },
        ],
      }),
      BINDINGS,
    );
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as {
      error: { details: Array<{ field: string; message: string }> };
    };
    expect(badBody.error.details.some((d) => d.field.includes("href"))).toBe(true);

    mockAll((url, init) => identityAs("booking_manager")(url, init));
    const no = await app.request(
      "/api/v1/admin/settings/public.nav_config",
      put({ value: [] }),
      BINDINGS,
    );
    expect(no.status).toBe(403);
  });
});

/* ---------------------------------- nav editor ---------------------------------- */

describe("GET/PUT /admin/settings/nav", () => {
  it("returns the stored tabs", async () => {
    mockAll((url, init) => {
      if (url.includes("/rest/v1/site_settings?key=eq.public.nav_config")) {
        return json([{ key: "public.nav_config", value: [VALID_TAB], updated_at: null }]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/settings/nav", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { tabs: Array<unknown> } };
    expect(body.data.tabs).toHaveLength(1);
  });

  it("saves valid tabs and pings the deploy hook on change", async () => {
    let row: Record<string, unknown> | undefined;
    let hookCalled = false;
    const bindings = { ...BINDINGS, FRONTEND_DEPLOY_HOOK_URL: "https://hooks.pages.dev/hook1" };
    mockAll((url, init) => {
      if (url.includes("hooks.pages.dev")) {
        hookCalled = true;
        return new Response("ok");
      }
      if (url.includes("/rest/v1/site_settings?key=eq.public.nav_config")) {
        return json([{ key: "public.nav_config", value: [], updated_at: null }]); // prev differs
      }
      if (url.includes("/rest/v1/site_settings?on_conflict=key") && init?.method === "POST") {
        row = (JSON.parse(init.body as string) as Array<Record<string, unknown>>)[0];
        return json([row], 201);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/settings/nav", put([VALID_TAB]), bindings);
    expect(res.status).toBe(200);
    expect(row?.key).toBe("public.nav_config");
    expect(hookCalled).toBe(true);
  });

  it("does not ping the hook when nothing changed", async () => {
    let hookCalled = false;
    const bindings = { ...BINDINGS, FRONTEND_DEPLOY_HOOK_URL: "https://hooks.pages.dev/hook1" };
    const same = JSON.parse(JSON.stringify([VALID_TAB])) as Array<Record<string, unknown>>;
    mockAll((url, init) => {
      if (url.includes("hooks.pages.dev")) {
        hookCalled = true;
        return new Response("ok");
      }
      if (url.includes("/rest/v1/site_settings?key=eq.public.nav_config")) {
        return json([{ key: "public.nav_config", value: same, updated_at: null }]);
      }
      if (url.includes("/rest/v1/site_settings?on_conflict=key") && init?.method === "POST") {
        return json([{ key: "public.nav_config" }], 201);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/settings/nav", put(same), bindings);
    expect(res.status).toBe(200);
    expect(hookCalled).toBe(false);
  });

  it("rejects unknown fields, bad hrefs and non-arrays with field errors", async () => {
    mockAll((url, init) => identityAs("admin")(url, init));
    const nonArray = await app.request("/api/v1/admin/settings/nav", put({ tabs: [] }), BINDINGS);
    expect(nonArray.status).toBe(400);

    const unknown = await app.request(
      "/api/v1/admin/settings/nav",
      put([{ ...VALID_TAB, extra: 1 }]),
      BINDINGS,
    );
    expect(unknown.status).toBe(400);
    const unknownBody = (await unknown.json()) as { error: { details: Array<{ field: string }> } };
    expect(unknownBody.error.details.some((d) => d.field === "tabs[0].extra")).toBe(true);

    const badHref = await app.request(
      "/api/v1/admin/settings/nav",
      put([
        {
          ...VALID_TAB,
          menu: [
            {
              title: "g",
              links: [{ label: "L", href: "javascript:alert(1)" }],
            },
          ],
        },
      ]),
      BINDINGS,
    );
    expect(badHref.status).toBe(400);
    const badHrefBody = (await badHref.json()) as { error: { details: Array<{ field: string }> } };
    expect(badHrefBody.error.details.some((d) => d.field === "tabs[0].menu[0].links[0].href")).toBe(
      true,
    );
  });

  it("lets a content_editor save nav (nav.write tier)", async () => {
    mockAll((url, init) => {
      if (url.includes("/rest/v1/site_settings?key=eq.public.nav_config")) {
        return json([{ key: "public.nav_config", value: [], updated_at: null }]);
      }
      if (url.includes("/rest/v1/site_settings?on_conflict=key") && init?.method === "POST") {
        return json([{ key: "public.nav_config" }], 201);
      }
      return identityAs("content_editor")(url, init);
    });
    const res = await app.request("/api/v1/admin/settings/nav", put([VALID_TAB]), BINDINGS);
    expect(res.status).toBe(200);
  });
});

/* --------------------------------- subscribers --------------------------------- */

describe("admin subscribers", () => {
  it("lists with search + status filters and meta.total", async () => {
    let queried = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/newsletter_subscribers?")) {
        queried = url;
        return list([{ id: "s1", email: "ra@x.y" }]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/subscribers?q=ra&status=confirmed&page=2&per_page=10",
      authed(),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(queried).toContain("email=ilike.*ra*");
    expect(queried).toContain("confirmed_at=not.is.null");
    const body = (await res.json()) as { meta: { page: number; total: number } };
    expect(body.meta.page).toBe(2);
    expect(body.meta.total).toBe(1);
  });

  it("400s an empty patch and writes unsubscribed_at on a real one", async () => {
    let seen: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/newsletter_subscribers?id=eq.s1&select=")) {
        return json([
          { id: "s1", email: "a@b.c", confirmed_at: null, unsubscribed_at: null, source: "footer" },
        ]);
      }
      if (url.includes("/rest/v1/newsletter_subscribers?id=eq.s1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "s1", unsubscribed_at: seen?.unsubscribed_at }]);
      }
      return identityAs("admin")(url, init);
    });
    const empty = await app.request("/api/v1/admin/subscribers/s1", patch({}), BINDINGS);
    expect(empty.status).toBe(400);
    const ok = await app.request(
      "/api/v1/admin/subscribers/s1",
      patch({ unsubscribed: true }),
      BINDINGS,
    );
    expect(ok.status).toBe(200);
    expect(typeof seen?.unsubscribed_at).toBe("string");
    expect(seen?.unsubscribed_at).not.toBeNull();
  });

  it("deletes with a hashed email in the audit and response (DPDP)", async () => {
    mockAll((url, init) => {
      if (url.includes("/rest/v1/newsletter_subscribers?id=eq.s1&select=")) {
        return json([
          { id: "s1", email: "a@b.c", confirmed_at: null, unsubscribed_at: null, source: "footer" },
        ]);
      }
      if (url.includes("/rest/v1/newsletter_subscribers?id=eq.s1") && init?.method === "DELETE") {
        return json([]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/subscribers/s1",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email_sha256: string } };
    expect(body.data.email_sha256).toBe(await sha256Hex("a@b.c"));
  });

  it("403s the delete for a content_editor (newsletter.delete gate)", async () => {
    mockAll((url, init) => identityAs("content_editor")(url, init));
    const res = await app.request(
      "/api/v1/admin/subscribers/s1",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });

  it("marks the export capped at the 10k ceiling", async () => {
    mockAll((url, init) => {
      if (url.includes("/rest/v1/newsletter_subscribers")) {
        return json(
          Array.from({ length: 10000 }, (_, i) => ({
            email: `u${i}@x.y`,
            confirmed_at: null,
            unsubscribed_at: null,
            source: "footer",
            created_at: "2026-11-01T00:00:00Z",
          })),
        );
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/newsletter/export", authed(), BINDINGS);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-export-capped")).toBe("true");
  });
});

/* ----------------------------------- catalog ----------------------------------- */

describe("admin catalog (phase 4)", () => {
  it("lists live rows by default and trash rows with ?deleted=true", async () => {
    let liveUrl = "";
    let trashUrl = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/astrologers?select=") && (init?.method ?? "GET") === "GET") {
        if (url.includes("deleted_at=not.is.null")) trashUrl = url;
        else liveUrl = url;
        return list([{ id: "a1", slug: "a" }]);
      }
      return identityAs("admin")(url, init);
    });
    const live = await app.request("/api/v1/admin/astrologers", authed(), BINDINGS);
    expect(live.status).toBe(200);
    expect(liveUrl).toContain("deleted_at=is.null");
    const liveBody = (await live.json()) as { meta: { deleted: boolean; total: number } };
    expect(liveBody.meta.deleted).toBe(false);

    const trash = await app.request("/api/v1/admin/astrologers?deleted=true", authed(), BINDINGS);
    expect(trash.status).toBe(200);
    expect(trashUrl).toContain("deleted_at=not.is.null");
    const trashBody = (await trash.json()) as { meta: { deleted: boolean } };
    expect(trashBody.meta.deleted).toBe(true);
  });

  it("passes a sanitised q through to the name ilike filter", async () => {
    let queried = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?select=")) {
        queried = url;
        return list([]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/pujas?q=rama(iv)", authed(), BINDINGS);
    expect(res.status).toBe(200);
    // URLSearchParams encodes the sanitised space as "+"
    expect(queried).toContain("name=ilike.*rama+iv*");
    expect(queried).not.toContain("%28");
  });

  it("creates with the whitelist (unknown fields dropped, slug derived)", async () => {
    let row: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/astrologers?slug=eq.")) return json([]);
      if (url.endsWith("/rest/v1/astrologers") && init?.method === "POST") {
        row = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([row], 201);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/astrologers",
      post({ name: "Test Pandit", is_active: true, bogus_field: "nope" }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(row?.slug).toBe("test-pandit");
    expect(row?.name).toBe("Test Pandit");
    expect("bogus_field" in (row ?? {})).toBe(false);
  });

  it("stamps consent timestamps on PATCH (true → ISO)", async () => {
    let seen: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/astrologers?id=eq.a1&select=*")) {
        return json([{ id: "a1", slug: "a" }]);
      }
      if (url.includes("/rest/v1/astrologers?id=eq.a1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "a1" }]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/astrologers/a1",
      patch({ listing_consent_confirmed_at: true }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(typeof seen?.listing_consent_confirmed_at).toBe("string");
  });

  it("nulls sample_price when dakshina_on_request goes true", async () => {
    let seen: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1&select=*")) {
        return json([{ id: "p1", slug: "p" }]);
      }
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "p1" }]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/pujas/p1",
      patch({ dakshina_on_request: true, sample_price: 500 }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(seen?.sample_price).toBeNull();
  });

  it("closeout C2: a price-only cross-PATCH on a flagged row nulls the price and writes no flag", async () => {
    let seen: Record<string, unknown> | undefined;
    let audit: { details?: { fields?: string[] } } | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1&select=*")) {
        return json([{ id: "p1", slug: "p", dakshina_on_request: true, sample_price: null }]);
      }
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "p1" }]);
      }
      // closeout review #1: audit fields are computed POST-guard — the
      // price-only PATCH must list exactly what the client sent (AC 3)
      if (url.includes("/rest/v1/audit_log") && init?.method === "POST") {
        audit = JSON.parse(init.body as string) as { details?: { fields?: string[] } };
        return json({});
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/pujas/p1", patch({ sample_price: 500 }), BINDINGS);
    expect(res.status).toBe(200);
    expect(seen?.sample_price).toBeNull();
    expect("dakshina_on_request" in (seen ?? {})).toBe(false);
    expect(audit?.details?.fields).toEqual(["sample_price"]);
  });

  it("closeout C2 (review #2): a flag-only PATCH nulls the price and lists it in the audit", async () => {
    let seen: Record<string, unknown> | undefined;
    let audit: { details?: { fields?: string[] } } | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1&select=*")) {
        return json([{ id: "p1", slug: "p", dakshina_on_request: false, sample_price: 500 }]);
      }
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "p1" }]);
      }
      if (url.includes("/rest/v1/audit_log") && init?.method === "POST") {
        audit = JSON.parse(init.body as string) as { details?: { fields?: string[] } };
        return json({});
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/pujas/p1",
      patch({ dakshina_on_request: true }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(seen?.dakshina_on_request).toBe(true);
    expect(seen?.sample_price).toBeNull();
    const fields = audit?.details?.fields ?? [];
    expect(fields).toContain("dakshina_on_request");
    expect(fields).toContain("sample_price");
  });

  it("closeout C2: turning the flag off explicitly preserves the price", async () => {
    let seen: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1&select=*")) {
        return json([{ id: "p1", slug: "p", dakshina_on_request: true, sample_price: null }]);
      }
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "p1" }]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/pujas/p1",
      patch({ sample_price: 500, dakshina_on_request: false }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(seen?.sample_price).toBe(500);
    expect(seen?.dakshina_on_request).toBe(false);
  });

  it("closeout C2: a name-only PATCH on a flagged row changes neither field", async () => {
    let seen: Record<string, unknown> | undefined;
    let audit: { details?: { fields?: string[] } } | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1&select=*")) {
        return json([{ id: "p1", slug: "p", name: "Old", dakshina_on_request: true }]);
      }
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "p1" }]);
      }
      if (url.includes("/rest/v1/audit_log") && init?.method === "POST") {
        audit = JSON.parse(init.body as string) as { details?: { fields?: string[] } };
        return json({});
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/pujas/p1", patch({ name: "Renamed" }), BINDINGS);
    expect(res.status).toBe(200);
    expect(seen?.name).toBe("Renamed");
    expect("sample_price" in (seen ?? {})).toBe(false);
    expect("dakshina_on_request" in (seen ?? {})).toBe(false);
    expect(audit?.details?.fields).toEqual(["name"]);
  });

  it("soft-deletes by default and restores from trash", async () => {
    let seen: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "p1", slug: "p", deleted_at: seen?.deleted_at }]);
      }
      return identityAs("admin")(url, init);
    });
    const del = await app.request("/api/v1/admin/pujas/p1", authed({ method: "DELETE" }), BINDINGS);
    expect(del.status).toBe(200);
    expect(typeof seen?.deleted_at).toBe("string");

    const restore = await app.request("/api/v1/admin/pujas/p1/restore", post({}), BINDINGS);
    expect(restore.status).toBe(200);
    expect(seen?.deleted_at).toBeNull();
  });

  it("403s a purge for role admin and hard-deletes for super_admin", async () => {
    mockAll((url, init) => identityAs("admin")(url, init));
    const no = await app.request(
      "/api/v1/admin/pujas/p1?purge=true",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(no.status).toBe(403);

    let method = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1&select=*")) return json([{ id: "p1", slug: "p" }]);
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "DELETE") {
        method = "DELETE";
        return json([]);
      }
      return identityAs("super_admin")(url, init);
    });
    const yes = await app.request(
      "/api/v1/admin/pujas/p1?purge=true",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(yes.status).toBe(200);
    expect(method).toBe("DELETE");
    const body = (await yes.json()) as { data: { purged: boolean } };
    expect(body.data.purged).toBe(true);
  });

  it("reorders sequentially and 404s on an unknown id", async () => {
    const seen: Record<string, unknown> = {};
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.p1") && init?.method === "PATCH") {
        seen.p1 = (JSON.parse(init.body as string) as Record<string, unknown>).sort_order;
        return json([{ id: "p1" }]);
      }
      if (url.includes("/rest/v1/pujas?id=eq.p2") && init?.method === "PATCH") {
        seen.p2 = (JSON.parse(init.body as string) as Record<string, unknown>).sort_order;
        return json([{ id: "p2" }]);
      }
      return identityAs("admin")(url, init);
    });
    const ok = await app.request(
      "/api/v1/admin/catalog/reorder",
      post({ kind: "pujas", ids: ["p1", "p2"] }),
      BINDINGS,
    );
    expect(ok.status).toBe(200);
    expect(seen.p1).toBe(10);
    expect(seen.p2).toBe(20);

    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?id=eq.pX") && init?.method === "PATCH") return json([]);
      return identityAs("admin")(url, init);
    });
    const missing = await app.request(
      "/api/v1/admin/catalog/reorder",
      post({ kind: "pujas", ids: ["pX"] }),
      BINDINGS,
    );
    expect(missing.status).toBe(404);
  });
});

/* ----------------------- horoscope delete + tiebreakers ----------------------- */

describe("admin horoscopes (phase 4 amendments)", () => {
  it("orders with deterministic tiebreakers", async () => {
    let queried = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/horoscopes?")) {
        queried = url;
        return list([]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request("/api/v1/admin/horoscopes", authed(), BINDINGS);
    expect(res.status).toBe(200);
    expect(queried).toContain("updated_at.desc%2Cperiod.desc%2Csign.asc");
  });

  it("deletes a row as admin (horoscope.delete) with an audit", async () => {
    let method = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/horoscopes?id=eq.h1&select=")) {
        return json([
          { id: "h1", sign: "aries", period: "daily", date_key: "rolling", lang: "en" },
        ]);
      }
      if (url.includes("/rest/v1/horoscopes?id=eq.h1") && init?.method === "DELETE") {
        method = "DELETE";
        return json([]);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/horoscopes/h1",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(method).toBe("DELETE");
  });

  it("403s the delete for a content_editor", async () => {
    mockAll((url, init) => identityAs("content_editor")(url, init));
    const res = await app.request(
      "/api/v1/admin/horoscopes/h1",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });
});

/* ------------------------------- stats + blocks -------------------------------- */

describe("admin stats (deleted_at floors + subscribers.active)", () => {
  it("counts only live catalog rows and reports subscriber buckets", async () => {
    const urls: string[] = [];
    mockAll((url, init) => {
      // identity first — the generic branch would otherwise swallow /admin_users
      const ident = identityAs("admin")(url, init);
      if (ident) return ident;
      if (url.includes("/rest/v1/")) {
        urls.push(url);
        return list([{ id: "x" }]);
      }
      return undefined;
    });
    const res = await app.request("/api/v1/admin/stats", authed(), BINDINGS);
    expect(res.status).toBe(200);
    expect(
      urls.some((u) => u.includes("/rest/v1/astrologers?") && u.includes("deleted_at=is.null")),
    ).toBe(true);
    expect(
      urls.some((u) => u.includes("/rest/v1/pujas?") && u.includes("deleted_at=is.null")),
    ).toBe(true);
    const body = (await res.json()) as { data: { subscribers: { active: number } } };
    expect(typeof body.data.subscribers.active).toBe("number");
  });
});

describe("content-block upsert merge", () => {
  it("preserves payload keys the admin did not send", async () => {
    let written: Record<string, unknown> | undefined;
    mockAll((url, init) => {
      if (
        url.includes("/rest/v1/content_blocks?block_key=eq.kundli.notes&lang=eq.en&select=payload")
      ) {
        return json([{ payload: { title: "old", keep: "x" } }]);
      }
      if (
        url.includes("/rest/v1/content_blocks?on_conflict=block_key,lang") &&
        init?.method === "POST"
      ) {
        written = (JSON.parse(init.body as string) as Array<Record<string, unknown>>)[0] as Record<
          string,
          unknown
        >;
        return json([{ id: "b1" }], 201);
      }
      return identityAs("admin")(url, init);
    });
    const res = await app.request(
      "/api/v1/admin/content-blocks/kundli.notes",
      put({ lang: "en", payload: { title: "new", body: "b" } }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const payload = (written?.payload ?? {}) as Record<string, unknown>;
    expect(payload.keep).toBe("x");
    expect(payload.title).toBe("new");
    expect(payload.body).toBe("b");
  });
});

/* ------------------------------- public gates ---------------------------------- */

describe("public surface gates (0018 ripple)", () => {
  it("directory astrologers require consent and exclude deleted rows", async () => {
    let queried = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/astrologers?is_active=eq.true")) {
        queried = url;
        return json([
          {
            slug: "a",
            name: "A",
            title: "t",
            about: "x",
            expertise: [],
            languages: [],
            experience_years: 1,
            price_per_minute: 100,
            session_types: [],
            is_available: true,
            availability_label: "",
            is_sample: false,
          },
        ]);
      }
      return undefined;
    });
    const res = await app.request("/api/v1/astrologers", {}, BINDINGS);
    expect(res.status).toBe(200);
    expect(queried).toContain("listing_consent_confirmed_at=not.is.null");
    expect(queried).toContain("deleted_at=is.null");
  });

  it("directory pujas exclude deleted rows", async () => {
    let queried = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/pujas?is_active=eq.true")) {
        queried = url;
        return json([
          {
            slug: "p",
            name: "P",
            name_hi: null,
            category: "other",
            purpose: "",
            description: "",
            duration: "",
            mode: [],
            includes: [],
            sample_price: null,
            muhurat_note: "",
            is_sample: false,
          },
        ]);
      }
      return undefined;
    });
    const res = await app.request("/api/v1/pujas", {}, BINDINGS);
    expect(res.status).toBe(200);
    expect(queried).toContain("deleted_at=is.null");
  });

  it("booking lookups skip soft-deleted catalog rows", async () => {
    let astroLookup = "";
    mockAll((url, init) => {
      if (url.includes("/rest/v1/astrologers?slug=eq.pt-vidyadhar")) {
        astroLookup = url;
        return json([{ id: "ast1" }]);
      }
      if (url.includes("/rest/v1/consultation_requests") && init?.method === "POST") {
        return json([{ id: "req1" }], 201);
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/requests/consultation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test Person",
          phone: "+91 9876543210",
          email: "t@example.com",
          topic: "Career guidance",
          astrologer_slug: "pt-vidyadhar",
        }),
      },
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(astroLookup).toContain("is_active=eq.true");
    expect(astroLookup).toContain("deleted_at=is.null");
  });
});
