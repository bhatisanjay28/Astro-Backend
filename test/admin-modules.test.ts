import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Route tests for Epic 6.4 admin modules: auth proxy, catalogues
 * (astrologers/pujas), horoscope content, inboxes (requests/messages),
 * newsletter CSV export and site settings. Identity/auth middleware is
 * mocked (see admin-posts-route.test.ts for the shared pattern).
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
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

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockSupabase(handler: Handler) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("fake-project.supabase.co")) return new Response("unmocked", { status: 599 });
    return handler(url, init ?? {}) ?? new Response("unmocked: " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const identityOk: Handler = (url) => {
  if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "admin@vyotish.com" });
  if (url.includes("/rest/v1/admin_users"))
    return json([{ user_id: "user-1", email: "admin@vyotish.com", role: "admin" }]);
  return undefined;
};

describe("POST /api/v1/auth/login (proxy)", () => {
  it("returns the token bundle on valid Supabase credentials", async () => {
    mockSupabase((url) => {
      if (url.includes("/auth/v1/token?grant_type=password")) {
        return json({
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          user: { id: "u", email: "a@b.c" },
        });
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.c", password: "pw" }),
      },
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { access_token: string; user: { email: string } } };
    expect(body.data.access_token).toBe("tok");
    expect(body.data.user.email).toBe("a@b.c");
  });

  it("401s on bad credentials and 400s on a missing password", async () => {
    mockSupabase((url) => {
      if (url.includes("/auth/v1/token?grant_type=password"))
        return json({ msg: "Invalid login credentials" }, 400);
      return undefined;
    });
    const bad = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.c", password: "nope" }),
      },
      BINDINGS,
    );
    expect(bad.status).toBe(401);
    const missing = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.c" }),
      },
      BINDINGS,
    );
    expect(missing.status).toBe(400);
  });

  it("503s without backend credentials", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(res.status).toBe(503);
  });
});

describe("admin catalogues (astrologers/pujas)", () => {
  it("validates astrologer payload and lists rows", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/astrologers") && init?.method === "POST") {
        return json([{ id: "a1", slug: "new-pandit" }], 201);
      }
      if (url.includes("/rest/v1/astrologers?select=")) return json([{ id: "a1" }]);
      return identityOk(url);
    });
    const bad = await app.request(
      "/api/v1/admin/astrologers",
      post({ name: "", session_types: "no" }),
      BINDINGS,
    );
    expect(bad.status).toBe(400);
    const ok = await app.request(
      "/api/v1/admin/astrologers",
      post({
        name: "New Pandit",
        expertise: ["vedic"],
        session_types: [{ type: "call", duration_min: 15 }],
      }),
      BINDINGS,
    );
    expect(ok.status).toBe(201);
    const list = await app.request("/api/v1/admin/astrologers", authed(), BINDINGS);
    expect(list.status).toBe(200);
  });

  it("maps duplicate slug to 409 for pujas and validates the category enum", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/pujas") && init?.method === "POST") {
        const text = init.body as string;
        return text.includes('"category":"bogus"')
          ? json([{ message: "check constraint" }], 200)
          : new Response("duplicate key value violates unique constraint", { status: 409 });
      }
      return identityOk(url);
    });
    const badCat = await app.request(
      "/api/v1/admin/pujas",
      post({ name: "X Puja", category: "bogus" }),
      BINDINGS,
    );
    expect(badCat.status).toBe(400);
    const dup = await app.request(
      "/api/v1/admin/pujas",
      post({ name: "X Puja", category: "graha_shanti" }),
      BINDINGS,
    );
    expect(dup.status).toBe(409);
  });

  it("404s a patch on a missing astrologer", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/astrologers?id=eq.missing")) return json([]);
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/astrologers/missing",
      patch({ is_active: false }),
      BINDINGS,
    );
    expect(res.status).toBe(404);
  });
});

describe("admin horoscope content", () => {
  it("creates a published row and stamps publish_at", async () => {
    let row: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/horoscopes") && init?.method === "POST") {
        row = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([row], 201);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/horoscopes",
      post({ sign: "aries", period: "daily", overview: "Good day", status: "published" }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(row?.publish_at).toBeTruthy();
    expect(row?.status).toBe("published");
  });

  it("409s a duplicate combo and 400s a bogus sign", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/horoscopes") && init?.method === "POST") {
        return new Response("duplicate key value violates unique constraint", { status: 409 });
      }
      return identityOk(url);
    });
    const dup = await app.request(
      "/api/v1/admin/horoscopes",
      post({ sign: "aries", period: "daily" }),
      BINDINGS,
    );
    expect(dup.status).toBe(409);
    const bogus = await app.request(
      "/api/v1/admin/horoscopes",
      post({ sign: "ophiuchus", period: "daily" }),
      BINDINGS,
    );
    expect(bogus.status).toBe(400);
  });

  it("patches text sections and clears publish_at when reverted to draft", async () => {
    let patch0: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/horoscopes?id=eq.h1") && init?.method === "PATCH") {
        patch0 = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "h1", ...patch0 }]);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/horoscopes/h1",
      patch({ overview: "Updated", status: "draft" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(patch0?.overview).toBe("Updated");
    expect(patch0?.publish_at).toBeNull();
  });
});

describe("admin inboxes (requests + messages)", () => {
  it("lists consultation requests with pagination meta", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/consultation_requests?")) {
        return json([{ id: "r1", status: "new" }], 200, { "content-range": "0-0/1" });
      }
      return identityOk(url);
    });
    const res = await app.request("/api/v1/admin/requests?type=consultation", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { type: string; requests: unknown[] };
      meta: { total: number };
    };
    expect(body.data.type).toBe("consultation");
    expect(body.meta.total).toBe(1);
  });

  it("lists an empty page (not 500) when pagination offset is past the row count", async () => {
    // PostgREST answers 416 PGRST103 for ?page=2 on a 1-row table. BUG-02
    // regression: admin listings used to map that to a 500.
    mockSupabase((url) => {
      if (url.includes("/rest/v1/consultation_requests?")) {
        return json({ code: "PGRST103", message: "Requested range not satisfiable" }, 416, {
          "content-range": "*/1",
        });
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/requests?type=consultation&page=2",
      authed(),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { requests: unknown[] };
      meta: { page: number; total: number };
    };
    expect(body.data.requests).toEqual([]);
    expect(body.meta.page).toBe(2);
    expect(body.meta.total).toBe(1);
  });

  it("rejects a bogus request status", async () => {
    mockSupabase(identityOk);
    const res = await app.request(
      "/api/v1/admin/requests/r1",
      patch({ type: "puja", status: "bogus" }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });

  it("patches a request status to scheduled", async () => {
    let seen: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/puja_requests?id=eq.r9") && init?.method === "PATCH") {
        seen = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ id: "r9", status: "scheduled" }]);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/requests/r9",
      patch({ type: "puja", status: "scheduled" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(seen?.status).toBe("scheduled");
  });

  it("patches a contact message to closed", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/contact_messages?id=eq.m1") && init?.method === "PATCH") {
        return json([{ id: "m1", status: "closed" }]);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/messages/m1",
      patch({ status: "closed" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
  });
});

describe("newsletter export + settings", () => {
  it("streams subscribers as CSV", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/newsletter_subscribers")) {
        return json([
          {
            email: "a@b.c",
            confirmed_at: null,
            unsubscribed_at: null,
            source: "footer",
            created_at: "2026-11-20T00:00:00Z",
          },
        ]);
      }
      return identityOk(url);
    });
    const res = await app.request("/api/v1/admin/newsletter/export", authed(), BINDINGS);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain('"a@b.c"');
    expect(text).toContain("email,confirmed_at");
  });

  it("upserts a setting and validates the key shape", async () => {
    let row: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/site_settings?on_conflict=key") && init?.method === "POST") {
        row = (JSON.parse(init.body as string) as Array<Record<string, unknown>>)[0];
        return json([row], 201);
      }
      return identityOk(url);
    });
    const ok = await app.request(
      "/api/v1/admin/settings/gemstones_site_url",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "https://gems.example.com" }),
      }),
      BINDINGS,
    );
    expect(ok.status).toBe(200);
    expect(row?.key).toBe("gemstones_site_url");
    const bad = await app.request(
      "/api/v1/admin/settings/BAD KEY!",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: 1 }),
      }),
      BINDINGS,
    );
    expect(bad.status).toBe(400);
  });
});
