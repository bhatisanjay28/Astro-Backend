import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";
import {
  assertMessageTransition,
  assertRequestTransition,
  MESSAGE_TRANSITIONS,
  REQUEST_TRANSITIONS,
  TransitionError,
} from "../src/lib/inbox-flow";

/**
 * Admin Phase 2 — dashboard stats + inbox workflow (story: phase-2-dashboard-
 * inbox; ACs 1–7). Covers: transition-map enforcement (requests AND messages),
 * verify-before-close 409, PII masking per role + the read_pii audit trail,
 * stats accuracy (dashboard no longer lies), filter semantics (test/archive/
 * per-table date columns — regression for the live puja-tab 500), CSV export
 * (inbox.export gate, audit, rate limit) and the 5-role 403 matrix.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  RATE_LIMIT_DISABLED: "1",
};

const NO_LIMIT_BINDINGS = {
  SUPABASE_URL: BINDINGS.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: BINDINGS.SUPABASE_SERVICE_ROLE_KEY,
};

const originalFetch = globalThis.fetch;

const b64 = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fakeJwt = (sub = "user-1") => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub })}.sig`;

type Row = Record<string, unknown>;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const authed = (token = fakeJwt()) => ({ headers: { Authorization: `Bearer ${token}` } });
const jsonReq = (method: string, body: unknown, token = fakeJwt()): RequestInit => ({
  method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

interface BackendSpec {
  userId?: string;
  role?: string;
  handle?: (url: string, method: string, body: Row | undefined) => Response | undefined;
}

interface AuditCapture {
  /** action strings in write order */
  actions: string[];
  /** full audit bodies (action + details) in write order */
  rows: Row[];
}

/** Installs a fetch mock that resolves identity + captures audit entries. */
function installBackend(spec: BackendSpec = {}): AuditCapture {
  const capture: AuditCapture = { actions: [], rows: [] };
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Row | undefined;
    try {
      body = typeof init?.body === "string" ? (JSON.parse(init.body) as Row) : undefined;
    } catch {
      body = undefined;
    }
    if (url.includes("/rest/v1/audit_log") && method === "POST") {
      capture.rows.push(body ?? {});
      capture.actions.push(String(body?.action));
      return json({});
    }
    if (url.includes("/auth/v1/user")) {
      return json({ id: spec.userId ?? "user-1", email: "staff@vyotish.com" });
    }
    if (url.includes("/rest/v1/admin_users")) {
      return json([
        {
          user_id: spec.userId ?? "user-1",
          email: "staff@vyotish.com",
          role: spec.role ?? "admin",
          is_active: true,
          display_name: "Staff",
        },
      ]);
    }
    return spec.handle?.(url, method, body) ?? new Response("unmocked", { status: 599 });
  }) as unknown as typeof fetch;
  return capture;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const CONSULT = (over: Row = {}): Row => ({
  id: "c1",
  name: "Seeker One",
  phone: "9164754255",
  email: "seeker@gmail.com",
  topic: "Career & Business",
  preferred_date: "2026-12-01",
  preferred_time: "10:00",
  birth_details: { date: "1990-01-01", time: "06:00", place: "Jaipur" },
  birth_details_consent: true,
  message: "Please help with career.",
  status: "new",
  created_at: "2026-11-26T10:00:00Z",
  scheduled_for: null,
  assignee_id: null,
  is_test: false,
  archived_at: null,
  verified_at: null,
  verified_by: null,
  closed_reason: null,
  closed_at: null,
  ...over,
});

const PUJA = (over: Row = {}): Row => ({
  id: "p1",
  name: "Puja Seeker",
  phone: "9811111111",
  email: "puja@gmail.com",
  puja_id: "puja-1",
  gotra: "Kashyap",
  date: "2026-12-05",
  location: "Jaipur",
  language: "Hindi",
  message: "Book a puja.",
  status: "new",
  created_at: "2026-11-26T09:00:00Z",
  scheduled_for: null,
  assignee_id: null,
  is_test: false,
  archived_at: null,
  verified_at: null,
  verified_by: null,
  closed_reason: null,
  closed_at: null,
  ...over,
});

const MESSAGE = (over: Row = {}): Row => ({
  id: "m1",
  name: "Mailer",
  email: "mailer@gmail.com",
  subject: "Question",
  message: "How do I book?",
  status: "new",
  created_at: "2026-11-26T08:00:00Z",
  is_test: false,
  archived_at: null,
  ...over,
});

/** Current-row lookup response for the workflow columns the PATCH flow reads. */
const CURRENT = (status: string, over: Row = {}): Row[] => [
  {
    id: "c1",
    status,
    verified_at: null,
    scheduled_for: null,
    assignee_id: null,
    is_test: false,
    archived_at: null,
    closed_at: null,
    ...over,
  },
];

let lastUrl = "";
function captureConsultList(
  rows: Row[],
): (url: string, method: string, body: Row | undefined) => Response | undefined {
  return (url: string, method: string) => {
    if (url.includes("/rest/v1/consultation_requests?") && method === "GET") {
      lastUrl = url;
      return json(rows, 200, { "content-range": `0-${rows.length - 1}/${rows.length}` });
    }
    return undefined;
  };
}

/* ------------------------------------------------------------------------ */

describe("transition maps (unit — inbox-flow)", () => {
  it("closed and cancelled are terminal in BOTH maps", () => {
    for (const terminal of ["closed", "cancelled"] as const) {
      expect(REQUEST_TRANSITIONS[terminal]).toEqual([]);
      expect(MESSAGE_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("the verify gate blocks close until verified, and verified rows never reopen", () => {
    expect(() => assertRequestTransition("new", "closed", false)).toThrow(TransitionError);
    expect(() => assertRequestTransition("new", "closed", true)).not.toThrow();
    expect(() => assertRequestTransition("completed", "scheduled", true)).toThrow(TransitionError);
    expect(() => assertRequestTransition("completed", "scheduled", false)).not.toThrow();
    expect(() => assertMessageTransition("new", "read")).not.toThrow();
    expect(() => assertMessageTransition("read", "new")).toThrow(TransitionError);
  });
});

describe("request workflow (HTTP)", () => {
  it("new → contacted succeeds and audits consultation_requests.update", async () => {
    const audits = installBackend({
      handle: (url, method) => {
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET")
          return json(CURRENT("new"));
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1") && method === "PATCH")
          return json([CONSULT({ status: "contacted" })]);
        return undefined;
      },
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1",
      jsonReq("PATCH", { type: "consultation", status: "contacted" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(audits.actions).toEqual(["consultation_requests.update"]);
  });

  it("an off-map transition (closed → contacted) is 409 invalid_transition", async () => {
    installBackend({
      handle: (url, method) =>
        url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET"
          ? json(CURRENT("closed"))
          : undefined,
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1",
      jsonReq("PATCH", { type: "consultation", status: "contacted" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_transition");
  });

  it("close without verify is 409 with the exact owner message", async () => {
    installBackend({
      handle: (url, method) =>
        url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET"
          ? json(CURRENT("contacted"))
          : undefined,
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1",
      jsonReq("PATCH", { type: "consultation", status: "closed" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("verification_required");
    expect(body.error.message).toBe("Verify this request before closing it.");
  });

  it("verify then close stamps verify/closed_at and audits verify → update in order", async () => {
    let verified = false;
    const audits = installBackend({
      handle: (url, method, body) => {
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET")
          return json(
            CURRENT("contacted", { verified_at: verified ? "2026-11-26T11:00:00Z" : null }),
          );
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=id,verified_at"))
          return json([
            { id: "c1", verified_at: verified ? "2026-11-26T11:00:00Z" : null, verified_by: null },
          ]);
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1") && method === "PATCH") {
          const patch = body as Row;
          if (patch.verified_at) {
            verified = true;
            return json([{ id: "c1", verified_at: patch.verified_at }]);
          }
          return json([CONSULT({ status: "closed", closed_at: patch.closed_at as string })]);
        }
        return undefined;
      },
    });
    const v = await app.request(
      "/api/v1/admin/requests/c1/verify",
      jsonReq("POST", { type: "consultation" }),
      BINDINGS,
    );
    expect(v.status).toBe(200);
    const vBody = (await v.json()) as { data: { already_verified: boolean } };
    expect(vBody.data.already_verified).toBe(false);

    const res = await app.request(
      "/api/v1/admin/requests/c1",
      jsonReq("PATCH", {
        type: "consultation",
        status: "closed",
        closed_reason: "Handled on call",
      }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { request: { closed_at: string } } };
    expect(typeof body.data.request.closed_at).toBe("string");
    // AC 2: exact audit strings, verify first
    expect(audits.actions).toEqual([
      "consultation_requests.verify",
      "consultation_requests.update",
    ]);
  });

  it("verify is idempotent — a re-verify writes no new audit row", async () => {
    const audits = installBackend({
      handle: (url, method) => {
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=id,verified_at"))
          return json([{ id: "c1", verified_at: "2026-11-26T11:00:00Z", verified_by: "user-9" }]);
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET")
          return json(CURRENT("contacted", { verified_at: "2026-11-26T11:00:00Z" }));
        return undefined;
      },
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1/verify",
      jsonReq("POST", { type: "consultation" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { already_verified: boolean; verified_by: string } };
    expect(body.data.already_verified).toBe(true);
    expect(body.data.verified_by).toBe("user-9");
    expect(audits.actions).toEqual([]);
  });

  it("reschedule patches only scheduled_for, keeps status, and the audit shows old → new", async () => {
    let seenPatch: Row | undefined;
    const audits = installBackend({
      handle: (url, method, body) => {
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET")
          return json(CURRENT("scheduled", { scheduled_for: "2026-12-01T10:00:00Z" }));
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1") && method === "PATCH") {
          seenPatch = body;
          return json([CONSULT({ status: "scheduled", scheduled_for: "2026-12-02T15:30:00Z" })]);
        }
        return undefined;
      },
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1",
      jsonReq("PATCH", { type: "consultation", scheduled_for: "2026-12-02T15:30:00Z" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(seenPatch?.status).toBeUndefined();
    // the route normalises to full ISO before writing (pins that behaviour)
    expect(seenPatch?.scheduled_for).toBe("2026-12-02T15:30:00.000Z");
    expect(seenPatch?.closed_at).toBeUndefined();
    // the audit details diff carries the old → new scheduled_for (AC 6)
    expect(audits.actions).toEqual(["consultation_requests.update"]);
    const changes = (audits.rows[0]?.details as { changes: Row } | undefined)?.changes;
    expect(changes?.scheduled_for).toEqual({
      from: "2026-12-01T10:00:00Z",
      to: "2026-12-02T15:30:00.000Z",
    });
  });

  it("a terminal request cannot be rescheduled or reassigned (409)", async () => {
    installBackend({
      handle: (url, method) =>
        url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET"
          ? json(CURRENT("closed", { closed_at: "2026-11-26T12:00:00Z" }))
          : undefined,
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1",
      jsonReq("PATCH", { type: "consultation", scheduled_for: "2026-12-02T15:30:00Z" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
  });

  it("notes round-trip: create is audited request_notes.create and detail lists the note", async () => {
    const audits = installBackend({
      handle: (url, method, body) => {
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=id")) {
          return json([{ id: "c1" }]);
        }
        if (url.includes("/rest/v1/request_notes") && method === "POST") {
          return json([{ id: 7, ...(body as Row) }]);
        }
        if (url.includes("/rest/v1/request_notes") && method === "GET") {
          return json([
            {
              id: 7,
              body: "Called seeker",
              created_at: "2026-11-26T11:00:00Z",
              author_id: "user-1",
            },
          ]);
        }
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select=")) {
          return json([CONSULT()]);
        }
        return undefined;
      },
    });
    const create = await app.request(
      "/api/v1/admin/requests/c1/notes",
      jsonReq("POST", { type: "consultation", body: "Called seeker" }),
      BINDINGS,
    );
    expect(create.status).toBe(201);
    expect(audits.actions).toEqual(["request_notes.create"]);

    const detail = await app.request(
      "/api/v1/admin/requests/c1?type=consultation",
      authed(),
      BINDINGS,
    );
    const dBody = (await detail.json()) as { data: { notes: Array<{ body: string }> } };
    expect(dBody.data.notes[0]?.body).toBe("Called seeker");
  });

  it("an empty PATCH is a 400, not a silent success", async () => {
    installBackend({
      handle: (url, method) =>
        url.includes("/rest/v1/consultation_requests?id=eq.c1&select=") && method === "GET"
          ? json(CURRENT("new"))
          : undefined,
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1",
      jsonReq("PATCH", { type: "consultation" }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });
});

describe("PII masking (02 §C)", () => {
  it("viewer list reads are masked (phone/email/birth) with pii_masked flag", async () => {
    // viewer holds inbox.read but NOT inbox.read_pii — content_editor cannot
    // reach the inbox at all (403, pinned in the role matrix below)
    installBackend({
      role: "viewer",
      userId: "user-view",
      handle: captureConsultList([CONSULT()]),
    });
    const res = await app.request(
      "/api/v1/admin/requests?type=consultation",
      authed(fakeJwt("user-view")),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { requests: Array<Row & { pii_masked?: boolean }> };
    };
    const row = body.data.requests[0] ?? {};
    expect(row.pii_masked).toBe(true);
    expect(row.phone).toBe("•••• 4255");
    expect(row.email).toBe("s••••@gmail.com");
    expect(row.birth_details).toBeNull();
  });

  it("booking_manager detail reads get full PII and the read is audited read_pii", async () => {
    const audits = installBackend({
      role: "booking_manager",
      userId: "user-bm",
      handle: (url, method) => {
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select="))
          return json([CONSULT()]);
        if (url.includes("/rest/v1/request_notes") && method === "GET") return json([]);
        return undefined;
      },
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1?type=consultation",
      authed(fakeJwt("user-bm")),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { request: Row } };
    expect(body.data.request.phone).toBe("9164754255");
    expect(body.data.request.birth_details).toEqual({
      date: "1990-01-01",
      time: "06:00",
      place: "Jaipur",
    });
    expect(audits.actions).toEqual(["consultation_requests.read_pii"]);
  });

  it("masked-role detail reads leak nothing and write no read_pii audit", async () => {
    const audits = installBackend({
      role: "viewer",
      userId: "user-view",
      handle: (url, method) => {
        if (url.includes("/rest/v1/consultation_requests?id=eq.c1&select="))
          return json([CONSULT()]);
        if (url.includes("/rest/v1/request_notes") && method === "GET") return json([]);
        return undefined;
      },
    });
    const res = await app.request(
      "/api/v1/admin/requests/c1?type=consultation",
      authed(fakeJwt("user-view")),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { request: Row } };
    expect(body.data.request.phone).toBe("•••• 4255");
    expect(body.data.request.birth_details).toBeNull();
    expect(body.data.request.pii_masked).toBe(true);
    expect(audits.actions).toEqual([]);
  });

  it("search is name-only for masked roles — the upstream query never probes phone/email", async () => {
    installBackend({
      role: "viewer",
      userId: "user-view",
      handle: captureConsultList([CONSULT()]),
    });
    await app.request(
      "/api/v1/admin/requests?type=consultation&q=9164754255",
      authed(fakeJwt("user-view")),
      BINDINGS,
    );
    expect(lastUrl).toContain("name=ilike.");
    // the select list legitimately names the phone/email columns — the point
    // is that no ilike probe or or= filter ever targets them for a masked role
    expect(lastUrl).not.toContain("phone.ilike");
    expect(lastUrl).not.toContain("email.ilike");
    expect(lastUrl).not.toContain("or=");
  });

  it("read_pii roles search name+phone+email", async () => {
    installBackend({ role: "admin", handle: captureConsultList([CONSULT()]) });
    await app.request("/api/v1/admin/requests?type=consultation&q=9164", authed(), BINDINGS);
    expect(lastUrl).toContain("or=");
    expect(lastUrl).toContain("phone.ilike");
    expect(lastUrl).toContain("email.ilike");
  });
});

describe("list filters (story review #5/#6 semantics)", () => {
  it("type=puja lists against the REAL columns (regression: live 500)", async () => {
    installBackend({
      handle: (url, method) => {
        if (url.includes("/rest/v1/puja_requests?") && method === "GET") {
          return json([PUJA()], 200, { "content-range": "0-0/1" });
        }
        return undefined;
      },
    });
    const res = await app.request("/api/v1/admin/requests?type=puja", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { type: string; requests: Array<Row> } };
    expect(body.data.type).toBe("puja");
    expect(body.data.requests[0]?.gotra).toBe("Kashyap");
    expect(body.data.requests[0]?.location).toBe("Jaipur");
    expect(body.data.requests[0]?.language).toBe("Hindi");
  });

  it("test/archive defaults and overrides produce the pinned upstream filters", async () => {
    installBackend({ role: "admin", handle: captureConsultList([CONSULT()]) });
    const call = (qs: string) =>
      app.request(`/api/v1/admin/requests?type=consultation${qs}`, authed(), BINDINGS);

    await call("");
    expect(lastUrl).toContain("is_test=eq.false");
    expect(lastUrl).toContain("archived_at=is.null");

    await call("&include_test=true");
    expect(lastUrl).not.toContain("is_test=");
    expect(lastUrl).toContain("archived_at=is.null");

    await call("&is_test=true");
    expect(lastUrl).toContain("is_test=eq.true");

    await call("&archived=true");
    expect(lastUrl).toContain("archived_at=not.is.null");

    await call("&archived=any");
    expect(lastUrl).not.toContain("archived_at=");

    await call("&older_than=24h");
    // PostgREST params travel URL-encoded (parens → %28/%29)
    expect(decodeURIComponent(lastUrl)).toContain("status=in.(new,contacted)");
    expect(lastUrl).toContain("created_at=lt.");
  });

  it("date filters hit the per-table columns (preferred_date vs date)", async () => {
    installBackend({ role: "admin", handle: captureConsultList([CONSULT()]) });
    await app.request(
      "/api/v1/admin/requests?type=consultation&date_from=2026-12-01&date_to=2026-12-31",
      authed(),
      BINDINGS,
    );
    expect(lastUrl).toContain("preferred_date=gte.2026-12-01");
    expect(lastUrl).toContain("preferred_date=lte.2026-12-31");

    installBackend({
      handle: (url, method) => {
        if (url.includes("/rest/v1/puja_requests?") && method === "GET") {
          lastUrl = url;
          return json([], 200, { "content-range": "*/0" });
        }
        return undefined;
      },
    });
    await app.request("/api/v1/admin/requests?type=puja&date_from=2026-12-05", authed(), BINDINGS);
    expect(lastUrl).toContain("date=gte.2026-12-05");
    expect(lastUrl).not.toContain("preferred_date");
  });

  it("bogus status / malformed dates are 400", async () => {
    installBackend({ role: "admin", handle: captureConsultList([]) });
    const bad1 = await app.request(
      "/api/v1/admin/requests?type=consultation&status=nope",
      authed(),
      BINDINGS,
    );
    expect(bad1.status).toBe(400);
    const bad2 = await app.request(
      "/api/v1/admin/requests?type=consultation&date_from=01-12-2026",
      authed(),
      BINDINGS,
    );
    expect(bad2.status).toBe(400);
  });
});

describe("CSV export", () => {
  it("streams full-PII CSV, respects filters, and audits <table>.export", async () => {
    const audits = installBackend({
      role: "booking_manager",
      userId: "user-bm",
      handle: (url, method) => {
        if (url.includes("/rest/v1/puja_requests?") && method === "GET") {
          lastUrl = url;
          return json([PUJA()], 200, { "content-range": "0-0/1" });
        }
        return undefined;
      },
    });
    const res = await app.request(
      "/api/v1/admin/requests/export.csv?type=puja&status=new",
      authed(fakeJwt("user-bm")),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("9811111111"); // full PII regardless of caller
    expect(csv).toContain("Kashyap");
    expect(lastUrl).toContain("status=eq.new");
    expect(lastUrl).toContain("is_test=eq.false");
    expect(audits.actions).toEqual(["puja_requests.export"]);
  });

  it("viewer holds inbox.read but NOT inbox.export — export is 403", async () => {
    installBackend({ role: "viewer", userId: "user-view" });
    const res = await app.request(
      "/api/v1/admin/requests/export.csv?type=consultation",
      authed(fakeJwt("user-view")),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });

  it("the admin:export bucket limits a user to 5 exports per minute", async () => {
    installBackend({
      role: "booking_manager",
      userId: "user-export",
      handle: (url, method) =>
        url.includes("/rest/v1/consultation_requests?") && method === "GET"
          ? json([], 200, { "content-range": "*/0" })
          : undefined,
    });
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await app.request(
        "/api/v1/admin/requests/export.csv?type=consultation",
        authed(fakeJwt("user-export")),
        NO_LIMIT_BINDINGS,
      );
    }
    expect(last?.status).toBe(429);
  });
});

describe("GET /admin/stats (the dashboard stops lying)", () => {
  it("counts the right sets and sums both request kinds", async () => {
    const urls: string[] = [];
    installBackend({
      role: "viewer",
      userId: "user-view",
      handle: (url, method) => {
        if (method !== "GET") return undefined;
        const respond = (total: number): Response =>
          json([], 200, { "content-range": `*/${total}` });
        if (url.includes("/rest/v1/blog_posts?")) {
          urls.push(url);
          if (url.includes("status=eq.published")) return respond(7);
          if (url.includes("status=eq.draft")) return respond(2);
          return respond(1); // trashed
        }
        if (url.includes("/rest/v1/astrologers?")) {
          return url.includes("is_active=eq.true") ? respond(3) : respond(1);
        }
        if (url.includes("/rest/v1/pujas?")) return respond(5);
        if (url.includes("/rest/v1/consultation_requests?")) {
          urls.push(url);
          if (url.includes("status=eq.new")) return respond(2);
          if (url.includes("status=in.(new,contacted)")) return respond(1);
          if (url.includes("status=eq.scheduled")) return respond(1);
          if (url.includes("status=eq.closed")) return respond(2);
          return respond(0);
        }
        if (url.includes("/rest/v1/puja_requests?")) {
          urls.push(url);
          if (url.includes("status=eq.new")) return respond(1);
          if (url.includes("status=in.(new,contacted)")) return respond(0);
          if (url.includes("status=eq.scheduled")) return respond(1);
          if (url.includes("status=eq.closed")) return respond(0);
          return respond(0);
        }
        if (url.includes("/rest/v1/newsletter_subscribers?")) {
          return url.includes("confirmed_at") ? respond(9) : respond(1);
        }
        if (url.includes("/rest/v1/media?")) return respond(4);
        return undefined;
      },
    });
    const res = await app.request("/api/v1/admin/stats", authed(fakeJwt("user-view")), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, Record<string, number>> };
    expect(body.data.posts).toEqual({ published: 7, draft: 2, trashed: 1 });
    expect(body.data.astrologers).toEqual({ active: 3, inactive: 1 });
    expect(body.data.pujas).toEqual({ active: 5 });
    expect(body.data.inbox).toEqual({ new: 3, older_24h: 1, scheduled_today: 2, closed_7d: 2 });
    expect(body.data.subscribers).toEqual({ confirmed: 9, unsubscribed: 1 });
    expect(body.data.media).toEqual({ count: 4 });
    // AC 5 regression: puja scheduled_today queries the REAL column
    const pujaToday = urls.find(
      (u) => u.includes("/rest/v1/puja_requests?") && u.includes("status=eq.scheduled"),
    );
    expect(pujaToday).toContain("date.eq.");
    expect(pujaToday).not.toContain("preferred_date");
    // closed_7d uses the closed_at stamp
    const closed = urls.find((u) => u.includes("status=eq.closed"));
    expect(closed).toContain("closed_at=gte.");
  });

  it("a failed upstream count is a 500, never a silent zero", async () => {
    installBackend({
      handle: (url, method) =>
        url.includes("/rest/v1/blog_posts?") && method === "GET"
          ? new Response("boom", { status: 500 })
          : undefined,
    });
    const res = await app.request("/api/v1/admin/stats", authed(), BINDINGS);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Could not compute stats");
  });
});

describe("message workflow", () => {
  it("new → read succeeds; read → new is 409", async () => {
    installBackend({
      handle: (url, method) => {
        if (url.includes("/rest/v1/contact_messages?id=eq.m1&select=") && method === "GET")
          return json([{ id: "m1", status: "new", is_test: false, archived_at: null }]);
        if (url.includes("/rest/v1/contact_messages?id=eq.m1") && method === "PATCH")
          return json([MESSAGE({ status: "read" })]);
        return undefined;
      },
    });
    const ok = await app.request(
      "/api/v1/admin/messages/m1",
      jsonReq("PATCH", { status: "read" }),
      BINDINGS,
    );
    expect(ok.status).toBe(200);

    installBackend({
      handle: (url, method) =>
        url.includes("/rest/v1/contact_messages?id=eq.m1&select=") && method === "GET"
          ? json([{ id: "m1", status: "read", is_test: false, archived_at: null }])
          : undefined,
    });
    const back = await app.request(
      "/api/v1/admin/messages/m1",
      jsonReq("PATCH", { status: "new" }),
      BINDINGS,
    );
    expect(back.status).toBe(409);
  });

  it("a closed message cannot go back to read (409)", async () => {
    installBackend({
      handle: (url, method) =>
        url.includes("/rest/v1/contact_messages?id=eq.m1&select=") && method === "GET"
          ? json([{ id: "m1", status: "closed", is_test: false, archived_at: null }])
          : undefined,
    });
    const res = await app.request(
      "/api/v1/admin/messages/m1",
      jsonReq("PATCH", { status: "read" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
  });

  it("message list masks email for masked roles", async () => {
    installBackend({
      role: "viewer",
      userId: "user-view",
      handle: (url, method) =>
        url.includes("/rest/v1/contact_messages?") && method === "GET"
          ? json([MESSAGE()], 200, { "content-range": "0-0/1" })
          : undefined,
    });
    const res = await app.request("/api/v1/admin/messages", authed(fakeJwt("user-view")), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { messages: Array<Row> } };
    expect((body.data.messages[0] ?? {}).email).toBe("m••••@gmail.com");
    expect((body.data.messages[0] ?? {}).pii_masked).toBe(true);
  });
});

describe("role matrix on the new endpoints (AC 7)", () => {
  it("viewer reads masked lists + stats, cannot write or export", async () => {
    const t = fakeJwt("user-view");
    installBackend({
      role: "viewer",
      userId: "user-view",
      handle: (url, method) => {
        if (url.includes("/rest/v1/consultation_requests?") && !url.includes("select=id&"))
          return json([CONSULT()], 200, { "content-range": "0-0/1" });
        // stats: every count query (select=id&…) answers with a fixed total
        if (method === "GET" && url.includes("/rest/v1/"))
          return json([], 200, { "content-range": "*/7" });
        return undefined;
      },
    });
    expect(
      (await app.request("/api/v1/admin/requests?type=consultation", authed(t), BINDINGS)).status,
    ).toBe(200);
    expect((await app.request("/api/v1/admin/stats", authed(t), BINDINGS)).status).toBe(200);
    installBackend({ role: "viewer", userId: "user-view" });
    expect(
      (
        await app.request(
          "/api/v1/admin/requests/c1",
          jsonReq("PATCH", { type: "consultation", status: "contacted" }, t),
          BINDINGS,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "/api/v1/admin/requests/c1/verify",
          jsonReq("POST", { type: "consultation" }, t),
          BINDINGS,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "/api/v1/admin/requests/c1/notes",
          jsonReq("POST", { type: "consultation", body: "x" }, t),
          BINDINGS,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "/api/v1/admin/requests/export.csv?type=consultation",
          authed(t),
          BINDINGS,
        )
      ).status,
    ).toBe(403);
  });

  it("content_editor has NO inbox access at all (403 on list)", async () => {
    installBackend({ role: "content_editor", userId: "user-editor" });
    const res = await app.request(
      "/api/v1/admin/requests?type=consultation",
      authed(fakeJwt("user-editor")),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });

  it("an unknown/legacy role is 403 everywhere (fail-safe)", async () => {
    installBackend({ role: "editor", userId: "user-legacy" });
    const t = fakeJwt("user-legacy");
    expect(
      (await app.request("/api/v1/admin/requests?type=consultation", authed(t), BINDINGS)).status,
    ).toBe(403);
    expect((await app.request("/api/v1/admin/stats", authed(t), BINDINGS)).status).toBe(403);
    expect((await app.request("/api/v1/admin/messages", authed(t), BINDINGS)).status).toBe(403);
  });
});
