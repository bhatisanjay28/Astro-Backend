import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Turnstile bot-check pins (admin brief: "bot protection") for the four
 * anonymous write endpoints: /auth/login, /requests/consultation,
 * /requests/puja, /newsletter. TURNSTILE_SECRET_KEY unset → every endpoint
 * skips the check (the arming window + the 554-test regression surface);
 * set → missing/invalid token answers 400 captcha_required and nothing
 * downstream (Supabase write, Supabase auth grant, audit row) runs.
 *
 * Fetch is mocked with a URL router — siteverify (challenges.cloudflare.com)
 * and the Supabase REST/auth surfaces share globalThis.fetch. Unique
 * x-forwarded-for per case: the in-file throttle Maps are process-wide and
 * other suites share them.
 */

const BASE_BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  RATE_LIMIT_DISABLED: "1",
};

const SECURED = { ...BASE_BINDINGS, TURNSTILE_SECRET_KEY: "test-secret" };

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockFetch(handler: Handler) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    return handler(String(input), init ?? {}) ?? json({ unmocked: String(input) }, 599);
  }) as unknown as typeof fetch;
}

let ipSeq = 0;
const xffInit = (body: unknown, ip?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `10.9.${++ipSeq}.7` },
  body: JSON.stringify(body),
});

/** Siteverify handler: asserts remoteip pass-through, returns `success`. */
function siteverify(calls: { remoteip?: string; response?: string }[], success: boolean): Handler {
  return (url, init) => {
    if (!url.includes("challenges.cloudflare.com")) return undefined;
    const form = new URLSearchParams(String(init?.body ?? ""));
    calls.push({
      remoteip: form.get("remoteip") ?? undefined,
      response: form.get("response") ?? undefined,
    });
    return json({ success });
  };
}

const post = (path: string, body: unknown, bindings: Record<string, unknown>, ip?: string) =>
  app.request(path, xffInit(body, ip), bindings as never);

const CAPTCHA = { error: { code: "captcha_required" } };

describe("POST /api/v1/auth/login — Turnstile gate", () => {
  it("400 captcha_required on missing token; no grant, no audit row", async () => {
    let grantCalls = 0;
    let auditCalls = 0;
    const sv: { remoteip?: string; response?: string }[] = [];
    mockFetch((url, init) => {
      if (url.includes("challenges.cloudflare.com")) return siteverify(sv, true)(url, init);
      if (url.includes("/auth/v1/token?grant_type=password")) {
        grantCalls += 1;
        return json({ msg: "Invalid login credentials" }, 400);
      }
      if (url.includes("/rest/v1/audit_log")) {
        auditCalls += 1;
        return json([], 201);
      }
      return undefined;
    });
    const res = await post("/api/v1/auth/login", { email: "a@b.c", password: "pw" }, SECURED);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("captcha_required");
    expect(grantCalls).toBe(0);
    expect(auditCalls).toBe(0);
  });

  it("valid token + wrong credentials → 401 invalid_credentials + audit (today's semantics); remoteip forwarded", async () => {
    const sv: { remoteip?: string; response?: string }[] = [];
    let auditActions: string[] = [];
    mockFetch((url, init) => {
      if (url.includes("challenges.cloudflare.com")) return siteverify(sv, true)(url, init);
      if (url.includes("/auth/v1/token?grant_type=password")) return json({ msg: "Invalid" }, 400);
      if (url.includes("/rest/v1/audit_log")) {
        const sent = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
        auditActions.push(sent.action ?? "");
        return json([], 201);
      }
      return undefined;
    });
    const res = await post(
      "/api/v1/auth/login",
      { email: "a@b.c", password: "pw", turnstile_token: "tok-abc" },
      SECURED,
      "10.9.7.7",
    );
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("invalid_credentials");
    expect(sv).toHaveLength(1);
    expect(sv[0]?.response).toBe("tok-abc");
    expect(sv[0]?.remoteip).toBe("10.9.7.7");
    expect(auditActions).toEqual(["auth.login_failed"]);
  });

  it("secret unset → check skipped (no siteverify call), flow unchanged", async () => {
    let siteverifyCalls = 0;
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) {
        siteverifyCalls += 1;
        return json({ success: true });
      }
      if (url.includes("/auth/v1/token?grant_type=password")) return json({ msg: "Invalid" }, 400);
      if (url.includes("/rest/v1/audit_log")) return json([], 201);
      return undefined;
    });
    const res = await post("/api/v1/auth/login", { email: "a@b.c", password: "pw" }, BASE_BINDINGS);
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("invalid_credentials");
    expect(siteverifyCalls).toBe(0);
  });
});

describe("POST /api/v1/newsletter — Turnstile gate", () => {
  it("400 captcha_required on missing token; no upsert", async () => {
    let upserts = 0;
    mockFetch((url, init) => {
      if (url.includes("challenges.cloudflare.com")) return siteverify([], true)(url, init);
      if (url.includes("/rest/v1/newsletter_subscribers")) {
        upserts += 1;
        return json([], 201);
      }
      return undefined;
    });
    const res = await post("/api/v1/newsletter", { email: "a@b.co", source: "website" }, SECURED);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("captcha_required");
    expect(upserts).toBe(0);
  });

  it("valid token → subscribes exactly as before", async () => {
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) return json({ success: true });
      if (url.includes("/rest/v1/newsletter_subscribers")) return json([], 201);
      return undefined;
    });
    const res = await post(
      "/api/v1/newsletter",
      { email: "a@b.co", source: "website", turnstile_token: "tok-abc" },
      SECURED,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { data: { subscribed: boolean } };
    expect(data.data.subscribed).toBe(true);
  });

  it("siteverify network failure → 400 captcha_required (fail closed)", async () => {
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) throw new Error("network down");
      if (url.includes("/rest/v1/newsletter_subscribers")) return json([], 201);
      return undefined;
    });
    const res = await post(
      "/api/v1/newsletter",
      { email: "a@b.co", turnstile_token: "tok-abc" },
      SECURED,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("captcha_required");
  });

  it("siteverify success:false → 400 captcha_required", async () => {
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) return json({ success: false });
      if (url.includes("/rest/v1/newsletter_subscribers")) return json([], 201);
      return undefined;
    });
    const res = await post(
      "/api/v1/newsletter",
      { email: "a@b.co", turnstile_token: "tok-abc" },
      SECURED,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("captcha_required");
  });
});

describe("POST /api/v1/requests/* — Turnstile gate", () => {
  const consultation = { name: "Test User", phone: "+91 98765 43210", topic: "Career guidance" };
  const puja = { name: "Test User", phone: "+91 98765 43210" };

  it("consultation: 400 captcha_required on missing token; no insert", async () => {
    let inserts = 0;
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) return json({ success: true });
      if (url.includes("/rest/v1/consultation_requests")) {
        inserts += 1;
        return json([{ id: "req-1" }], 201);
      }
      return undefined;
    });
    const res = await post("/api/v1/requests/consultation", consultation, SECURED);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("captcha_required");
    expect(inserts).toBe(0);
  });

  it("consultation: valid token → 201 received, insert observed", async () => {
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) return json({ success: true });
      if (url.includes("/rest/v1/consultation_requests")) return json([{ id: "req-1" }], 201);
      return undefined;
    });
    const res = await post(
      "/api/v1/requests/consultation",
      { ...consultation, turnstile_token: "tok-abc" },
      SECURED,
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { data: { status: string; id: string | null } };
    expect(data.data.status).toBe("received");
    expect(data.data.id).toBe("req-1");
  });

  it("consultation: secret unset → 201 without token (arming-window regression)", async () => {
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) return json({ success: true });
      if (url.includes("/rest/v1/consultation_requests")) return json([{ id: "req-1" }], 201);
      return undefined;
    });
    const res = await post("/api/v1/requests/consultation", consultation, BASE_BINDINGS);
    expect(res.status).toBe(201);
  });

  it("puja: 400 captcha_required on missing token; no insert", async () => {
    let inserts = 0;
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) return json({ success: true });
      if (url.includes("/rest/v1/puja_requests")) {
        inserts += 1;
        return json([{ id: "p-1" }], 201);
      }
      return undefined;
    });
    const res = await post("/api/v1/requests/puja", puja, SECURED);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("captcha_required");
    expect(inserts).toBe(0);
  });

  it("puja: valid token → 201 received, insert observed", async () => {
    mockFetch((url) => {
      if (url.includes("challenges.cloudflare.com")) return json({ success: true });
      if (url.includes("/rest/v1/puja_requests")) return json([{ id: "p-1" }], 201);
      return undefined;
    });
    const res = await post(
      "/api/v1/requests/puja",
      { ...puja, turnstile_token: "tok-abc" },
      SECURED,
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { data: { status: string } };
    expect(data.data.status).toBe("received");
  });
});
