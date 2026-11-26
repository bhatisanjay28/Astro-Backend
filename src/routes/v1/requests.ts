/**
 * POST /api/v1/requests/consultation and POST /api/v1/requests/puja —
 * Epic 5.2/5.3 booking-request endpoints. Anon inserts into the
 * consultation_requests / puja_requests tables (RLS: anon can insert own).
 * Phone/email validation + same-isolate throttle + Turnstile bot check
 * (admin brief; skipped while TURNSTILE_SECRET_KEY is unset). Admin notify
 * stays with 6.4.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { captchaRequired, verifyTurnstile } from "../../lib/turnstile";

const PHONE_RE = /^[+\d][\d\s\-()]{6,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return true;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) {
    for (const [k, v] of recent) {
      if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
    }
  }
  return false;
}

interface PersonBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  message?: unknown;
}

function personProblems(body: PersonBody): string[] {
  const problems: string[] = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (name.length < 2 || name.length > 120) problems.push("name must be 2–120 characters");
  if (!PHONE_RE.test(phone)) problems.push("phone must be a valid phone number");
  if (email && !EMAIL_RE.test(email)) problems.push("email must be a valid email address");
  return problems;
}

function personFields(body: PersonBody): {
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
} {
  return {
    name: (typeof body.name === "string" ? body.name : "").trim(),
    phone: (typeof body.phone === "string" ? body.phone : "").trim(),
    email: typeof body.email === "string" && body.email.trim() ? body.email.trim() : null,
    message: typeof body.message === "string" && body.message.trim() ? body.message.trim() : null,
  };
}

export const requestsRoute = new Hono<AppEnv>();

requestsRoute.post("/requests/consultation", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (!c.env?.RATE_LIMIT_DISABLED && throttled(ip)) {
    return c.json(
      { error: { code: "rate_limited", message: "Too many requests. Try again later." } },
      429,
    );
  }
  let body: PersonBody & {
    turnstile_token?: unknown;
    astrologer_slug?: unknown;
    topic?: unknown;
    preferred_date?: unknown;
    preferred_time?: unknown;
    birth_details_consent?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "validation_error", message: "Body must be JSON" } }, 400);
  }
  const problems = personProblems(body);
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (topic.length < 2 || topic.length > 200) problems.push("topic is required (2–200 characters)");
  if (problems.length > 0) {
    return c.json(
      { error: { code: "validation_error", message: "Validation failed", details: problems } },
      400,
    );
  }
  if (!(await verifyTurnstile(body.turnstile_token, ip, c.env?.TURNSTILE_SECRET_KEY))) {
    return c.json(captchaRequired(), 400);
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "Booking requests require backend database credentials, which are not configured yet.",
        },
      },
      503,
    );
  }

  const p = personFields(body);
  let astrologerId: string | null = null;
  if (typeof body.astrologer_slug === "string" && body.astrologer_slug.trim()) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/astrologers?slug=eq.${encodeURIComponent(body.astrologer_slug.trim())}&is_active=eq.true&deleted_at=is.null&select=id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{ id: string }>;
      astrologerId = rows[0]?.id ?? null;
    }
  }

  const insert = {
    astrologer_id: astrologerId,
    name: p.name,
    phone: p.phone,
    email: p.email,
    topic,
    preferred_date:
      typeof body.preferred_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.preferred_date)
        ? body.preferred_date
        : null,
    preferred_time:
      typeof body.preferred_time === "string" && body.preferred_time.trim()
        ? body.preferred_time.trim().slice(0, 60)
        : null,
    birth_details: null,
    birth_details_consent: body.birth_details_consent === true,
    message: p.message,
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/consultation_requests`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(insert),
  });
  if (!res.ok) {
    console.error("[consultation] insert failed:", res.status);
    return c.json(
      {
        error: { code: "internal_error", message: "Could not save the request. Please try again." },
      },
      500,
    );
  }
  const rows = (await res.json()) as Array<{ id: string }>;
  return c.json(
    {
      data: {
        id: rows[0]?.id ?? null,
        status: "received",
        note: "Your consultation request is saved and routed to the admin inbox. Astrologers respond personally — expect contact within 24–48 hours.",
      },
      meta: {
        no_pii:
          "Stored: contact + request only. Birth details are NOT stored (consent flow lands with 6.4).",
      },
    },
    201,
  );
});

requestsRoute.post("/requests/puja", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (!c.env?.RATE_LIMIT_DISABLED && throttled(ip)) {
    return c.json(
      { error: { code: "rate_limited", message: "Too many requests. Try again later." } },
      429,
    );
  }
  let body: PersonBody & {
    turnstile_token?: unknown;
    puja_slug?: unknown;
    gotra?: unknown;
    date?: unknown;
    location?: unknown;
    language?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "validation_error", message: "Body must be JSON" } }, 400);
  }
  const problems = personProblems(body);
  if (problems.length > 0) {
    return c.json(
      { error: { code: "validation_error", message: "Validation failed", details: problems } },
      400,
    );
  }
  if (!(await verifyTurnstile(body.turnstile_token, ip, c.env?.TURNSTILE_SECRET_KEY))) {
    return c.json(captchaRequired(), 400);
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "Booking requests require backend database credentials, which are not configured yet.",
        },
      },
      503,
    );
  }

  const p = personFields(body);
  let pujaId: string | null = null;
  if (typeof body.puja_slug === "string" && body.puja_slug.trim()) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/pujas?slug=eq.${encodeURIComponent(body.puja_slug.trim())}&is_active=eq.true&deleted_at=is.null&select=id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{ id: string }>;
      pujaId = rows[0]?.id ?? null;
    }
  }

  const insert = {
    puja_id: pujaId,
    name: p.name,
    gotra:
      typeof body.gotra === "string" && body.gotra.trim() ? body.gotra.trim().slice(0, 80) : null,
    phone: p.phone,
    email: p.email,
    date: typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null,
    location:
      typeof body.location === "string" && body.location.trim()
        ? body.location.trim().slice(0, 200)
        : null,
    language:
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim().slice(0, 60)
        : null,
    message: p.message,
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/puja_requests`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(insert),
  });
  if (!res.ok) {
    console.error("[puja] insert failed:", res.status);
    return c.json(
      {
        error: { code: "internal_error", message: "Could not save the request. Please try again." },
      },
      500,
    );
  }
  const rows = (await res.json()) as Array<{ id: string }>;
  return c.json(
    {
      data: {
        id: rows[0]?.id ?? null,
        status: "received",
        note: "Your poojan request is saved and routed to the admin inbox. The team confirms muhurat, samagri and mode personally.",
      },
    },
    201,
  );
});
