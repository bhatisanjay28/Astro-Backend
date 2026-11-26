/**
 * Epic 4.2b route tests — keyed content blocks:
 *  - GET /api/v1/content/blocks?lang=&prefix= (public prefix read, 503/400/mapping)
 *  - /api/v1/admin/content-blocks CRUD (admin CRUD, identity mocked — shared
 *    pattern from admin-modules.test.ts)
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

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

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockSupabase(handler: Handler) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("fake-project.supabase.co")) return new Response("unmocked", { status: 599 });
    return handler(url, init ?? {}) ?? new Response("unmocked: " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const identityOk: Handler = (url) => {
  if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "admin@vyotish.com" });
  if (url.includes("/rest/v1/admin_users"))
    return json([{ user_id: "user-1", email: "admin@vyotish.com", role: "admin" }]);
  return undefined;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/v1/content/blocks (public prefix read)", () => {
  it("returns 503 service_unavailable without DB credentials", async () => {
    const res = await app.request("/api/v1/content/blocks?prefix=kundli.");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });

  it("rejects a bad lang and a malformed prefix", async () => {
    mockSupabase(identityOk);
    const fr = await app.request("/api/v1/content/blocks?lang=fr&prefix=kundli.", {}, BINDINGS);
    expect(fr.status).toBe(400);
    const noDot = await app.request("/api/v1/content/blocks?prefix=kundli", {}, BINDINGS);
    expect(noDot.status).toBe(400);
    const wildcard = await app.request("/api/v1/content/blocks?prefix=kundl*.", {}, BINDINGS);
    expect(wildcard.status).toBe(400);
  });

  it("maps prefix rows into a block map with is_sample rollup", async () => {
    mockSupabase((url) => {
      if (!url.includes("/rest/v1/content_blocks")) return undefined;
      expect(url).toContain("block_key=like.kundli.");
      expect(url).toContain("status=eq.published");
      return json([
        {
          block_key: "kundli.lagna",
          payload: { title: "Lagna", body: "…", is_sample: false },
          is_sample: false,
        },
        { block_key: "kundli.moon", payload: { title: "Moon sign", body: "…" }, is_sample: true },
      ]);
    });
    const res = await app.request("/api/v1/content/blocks?lang=en&prefix=kundli.", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lang: string; prefix: string; blocks: Record<string, unknown>; is_sample: boolean };
    };
    expect(body.data.lang).toBe("en");
    expect(body.data.prefix).toBe("kundli.");
    expect(Object.keys(body.data.blocks).sort()).toEqual(["kundli.lagna", "kundli.moon"]);
    expect(body.data.is_sample).toBe(true);
  });

  it("500s when Supabase REST fails", async () => {
    globalThis.fetch = mock(
      async () => new Response("nope", { status: 401 }),
    ) as unknown as typeof fetch;
    const res = await app.request("/api/v1/content/blocks?prefix=kundli.", {}, BINDINGS);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/v1/admin/content-blocks (list)", () => {
  it("401s without a bearer token and 200s with the block list", async () => {
    mockSupabase(identityOk);
    const anon = await app.request("/api/v1/admin/content-blocks", {}, BINDINGS);
    expect(anon.status).toBe(401);

    mockSupabase((url) => {
      if (url.includes("/rest/v1/admin_users") || url.includes("/auth/v1/user"))
        return identityOk(url);
      if (url.includes("/rest/v1/content_blocks")) {
        expect(url).toContain("block_key=like.kundli.");
        return json([{ block_key: "kundli.lagna", lang: "en", status: "published" }]);
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/admin/content-blocks?prefix=kundli.",
      authed(),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { blocks: Array<{ block_key: string }> } };
    expect(body.data.blocks[0]?.block_key).toBe("kundli.lagna");
  });
});

describe("PUT /api/v1/admin/content-blocks/:key (upsert)", () => {
  it("validates key, lang, status and payload", async () => {
    mockSupabase(identityOk);
    const badKey = await app.request(
      "/api/v1/admin/content-blocks/Bad%20Key",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: {} }),
      }),
      BINDINGS,
    );
    expect(badKey.status).toBe(400);

    const badLang = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "fr", payload: {} }),
      }),
      BINDINGS,
    );
    expect(badLang.status).toBe(400);

    const badStatus = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived", payload: {} }),
      }),
      BINDINGS,
    );
    expect(badStatus.status).toBe(400);

    const noPayload = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: "text" }),
      }),
      BINDINGS,
    );
    expect(noPayload.status).toBe(400);
  });

  it("upserts with merge-duplicates on (block_key, lang) and MERGES the payload", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/admin_users") || url.includes("/auth/v1/user"))
        return identityOk(url);
      if (url.includes("/rest/v1/content_blocks")) {
        if ((init?.method ?? "GET") === "GET") {
          // phase-4 merge-edit: PUT reads the previous payload first
          return json([
            { block_key: "kundli.lagna", lang: "en", payload: { keep: "existing", title: "Old" } },
          ]);
        }
        expect(url).toContain("on_conflict=block_key,lang");
        expect(String((init?.headers as Record<string, string>)?.Prefer)).toContain(
          "resolution=merge-duplicates",
        );
        const sent = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
        expect(sent[0]?.block_key).toBe("kundli.lagna");
        expect(sent[0]?.lang).toBe("en");
        expect(sent[0]?.status).toBe("published");
        const payload = sent[0]?.payload as Record<string, unknown>;
        // merge-edit: sent keys win, previous keys survive
        expect(payload.title).toBe("Lagna");
        expect(payload.body).toBe("The ascendant…");
        expect(payload.keep).toBe("existing");
        return json([{ block_key: "kundli.lagna", lang: "en", payload }]);
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { title: "Lagna", body: "The ascendant…" } }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { payload: Record<string, unknown> } };
    expect(body.data.payload.title).toBe("Lagna");
    expect(body.data.payload.keep).toBe("existing");
  });

  it("500s when the Supabase write fails", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/admin_users") || url.includes("/auth/v1/user"))
        return identityOk(url);
      if (url.includes("/rest/v1/content_blocks")) {
        if ((init?.method ?? "GET") === "GET") return json([]); // no previous block
        return json({ msg: "db down" }, 500);
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: {} }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(500);
  });

  it("fails the PUT without writing when the pre-read fails — merge must not degrade to a blind replace", async () => {
    let wrote = false;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/admin_users") || url.includes("/auth/v1/user"))
        return identityOk(url);
      if (url.includes("/rest/v1/content_blocks")) {
        if ((init?.method ?? "GET") === "GET") return new Response("nope", { status: 500 });
        wrote = true;
        return json([{ block_key: "kundli.lagna" }], 201);
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { title: "Only key sent" } }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(500);
    expect(wrote).toBe(false);
  });
});

describe("DELETE /api/v1/admin/content-blocks/:key", () => {
  it("deletes scoped to the key+lang and reports the deletion", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/admin_users") || url.includes("/auth/v1/user"))
        return identityOk(url);
      if (url.includes("/rest/v1/content_blocks")) {
        expect(init?.method).toBe("DELETE");
        expect(url).toContain("block_key=eq.kundli.lagna");
        expect(url).toContain("lang=eq.hi");
        return json([]);
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna?lang=hi",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean; lang: string } };
    expect(body.data.deleted).toBe(true);
    expect(body.data.lang).toBe("hi");
  });

  it("rejects an invalid lang", async () => {
    mockSupabase(identityOk);
    const res = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna?lang=fr",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });
});
