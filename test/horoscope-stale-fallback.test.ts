/**
 * S23 cron-repair — the "never a wrong date" fallback ladder on
 * GET /api/v1/horoscope. When the generator has not published the requested
 * IST window's rows yet (the exact 26 Nov failure mode), the route serves the
 * LATEST EARLIER window and reports it honestly: `date_key` is the content's
 * own key, `requested_date_key` is what the tab asked for, `stale: true`.
 *
 * Clock-robust: the mock keys everything off the route's own clock — the
 * "missing" bucket is whichever date_key the route actually asks for today.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { addDays, istDateKey } from "../src/horoscope/ist";
import { rest, type SupabaseCreds } from "../src/lib/supabase";
import { horoscopeRoute } from "../src/routes/v1/horoscope";

const originalFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

/** The date_key the fallback will serve — yesterday's IST daily key. */
const servedKey = addDays(istDateKey(new Date()), -1);

interface RowSpec {
  /** PostgREST date_key filter value the route must be asking for */
  dateKey: string;
  period: string;
  /** rows returned (fabricated per requested sign/period) */
  signs: string[];
}

/** Install a fetch mock serving fabricated horoscopes rows for a set of
 * (date_key, period) buckets. `latestKey` (optional) answers the route's
 * "latest earlier key" `date_key=lte.…` lookup; null/undefined → empty.
 * Everything else (content_blocks, other buckets) comes back empty. */
function installHoroscopeBackend(buckets: RowSpec[], latestKey?: string) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/horoscopes")) return json([]);
    const period = url.searchParams.get("period")?.replace(/^eq\./, "") ?? "";
    const dateKey = url.searchParams.get("date_key") ?? "";
    if (dateKey.startsWith("lte.")) {
      return latestKey ? json([{ date_key: latestKey }]) : json([]);
    }
    const bucket = buckets.find((b) => b.dateKey === dateKey.slice(3) && b.period === period);
    if (!bucket) return json([]);
    return json(
      bucket.signs.map((sign) => ({
        sign,
        period,
        date_key: bucket.dateKey,
        overview: `overview for ${sign} @ ${bucket.dateKey}`,
        love: null,
        career: null,
        finance: null,
        health: null,
        is_sample: false,
        payload: null,
      })),
    );
  }) as unknown as typeof fetch;
}

async function get(query: string): Promise<Response> {
  return horoscopeRoute.request(`/horoscope?${query}`, undefined, BINDINGS);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("stale-fallback ladder (S23: never a wrong date)", () => {
  it("fresh content: today's rows exist → date_key = today, stale = false, no fallback", async () => {
    const today = istDateKey(new Date());
    installHoroscopeBackend([{ dateKey: today, period: "daily", signs: ["aries"] }]);
    const res = await get("period=daily&lang=en&sign=aries");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { date_key: string; requested_date_key: string; stale: boolean; signs: unknown[] };
    };
    expect(body.data.date_key).toBe(today);
    expect(body.data.requested_date_key).toBe(today);
    expect(body.data.stale).toBe(false);
    expect(body.data.signs).toHaveLength(1);
  });

  it("today's rows missing → serves yesterday with its REAL date_key + stale:true", async () => {
    installHoroscopeBackend([{ dateKey: servedKey, period: "daily", signs: ["aries"] }], servedKey);
    const res = await get("period=daily&lang=en&sign=aries");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        date_key: string;
        requested_date_key: string;
        stale: boolean;
        resolved_period: string;
        signs: Array<{ sign: string; overview: string }>;
      };
    };
    expect(body.data.date_key).toBe(servedKey); // the CONTENT's own key
    expect(body.data.requested_date_key).toBe(istDateKey(new Date()));
    expect(body.data.stale).toBe(true);
    expect(body.data.resolved_period).toBe("daily");
    expect(body.data.signs[0]?.sign).toBe("aries");
    expect(body.data.signs[0]?.overview).toContain(servedKey);
  });

  it("weekly missing too → latest earlier weekly window, same honest flags", async () => {
    const monday = servedKey; // any earlier key works — the mock is format-agnostic
    installHoroscopeBackend([{ dateKey: monday, period: "weekly", signs: ["taurus"] }], monday);
    const res = await get("period=weekly&lang=en&sign=taurus");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { date_key: string; stale: boolean; resolved_period: string; signs: unknown[] };
    };
    expect(body.data.date_key).toBe(monday);
    expect(body.data.stale).toBe(true);
    expect(body.data.resolved_period).toBe("weekly");
    expect(body.data.signs).toHaveLength(1);
  });

  it("no earlier content at all → honest empty: requested date_key, stale:false, signs:[]", async () => {
    installHoroscopeBackend([]); // nothing in any bucket — rolling rung too
    const res = await get("period=daily&lang=en&sign=aries");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { date_key: string; requested_date_key: string; stale: boolean; signs: unknown[] };
    };
    expect(body.data.date_key).toBe(istDateKey(new Date()));
    expect(body.data.requested_date_key).toBe(body.data.date_key);
    expect(body.data.stale).toBe(false);
    expect(body.data.signs).toEqual([]);
  });

  it("rest() helper still targets the service-role PostgREST path (smoke)", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: unknown) => {
      capturedUrl = String(input);
      return json([]);
    }) as unknown as typeof fetch;
    await rest(
      { url: BINDINGS.SUPABASE_URL, key: BINDINGS.SUPABASE_SERVICE_ROLE_KEY } as SupabaseCreds,
      "horoscopes?select=sign",
    );
    expect(capturedUrl).toBe(`${BINDINGS.SUPABASE_URL}/rest/v1/horoscopes?select=sign`);
  });
});
