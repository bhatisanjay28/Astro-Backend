/**
 * GET /api/v1/settings — Epic 1.9 route tests (mocked Supabase REST).
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

function mockSupabase(handler: (path: string) => unknown) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    const path = url.split("/rest/v1/")[1] ?? "";
    return new Response(JSON.stringify(handler(path)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  mock.restore();
});

describe("GET /api/v1/settings", () => {
  it("503s without database credentials", async () => {
    const res = await app.request("/api/v1/settings");
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("service_unavailable");
  });

  it("maps engine rows → config (db source) and public strings", async () => {
    mockSupabase(() => [
      { key: "public.engine_ayanamsha", value: "lahiri" },
      { key: "public.engine_month_system", value: "amanta" },
      { key: "public.engine_house_system", value: "whole_sign" },
      { key: "public.engine_chart_style", value: "south_indian" },
      { key: "public.gemstones_site_url", value: "https://gems.example.com" },
      { key: "public.contact_email", value: "care@vyotish.com" },
      { key: "public.contact_whatsapp", value: "" },
    ]);
    const res = await app.request("/api/v1/settings", {}, BINDINGS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        engine: Record<string, string>;
        engine_sources: Record<string, string>;
        gemstones_site_url: string | null;
        contact_email: string | null;
        contact_whatsapp: string | null;
      };
    };
    expect(json.data.engine.month_system).toBe("amanta");
    expect(json.data.engine.chart_style).toBe("south_indian");
    expect(json.data.engine_sources.month_system).toBe("db");
    expect(json.data.gemstones_site_url).toBe("https://gems.example.com");
    expect(json.data.contact_email).toBe("care@vyotish.com");
    expect(json.data.contact_whatsapp).toBeNull(); // empty string → unset
  });

  it("passes offers_config through as JSON (Epic 5.2) or null when unset", async () => {
    mockSupabase(() => [
      {
        key: "public.offers_config",
        value: [{ text: "First consult free", audience: "consultation" }],
      },
    ]);
    const res = await app.request("/api/v1/settings", {}, BINDINGS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { offers_config: unknown } };
    expect(json.data.offers_config).toEqual([
      { text: "First consult free", audience: "consultation" },
    ]);

    mockSupabase(() => []);
    const unset = await app.request("/api/v1/settings", {}, BINDINGS);
    const unsetBody = (await unset.json()) as { data: { offers_config: unknown } };
    expect(unsetBody.data.offers_config).toBeNull();
  });

  it("serves the saved nav keys to the public ([R7]/AC5 pin — the build merge depends on them)", async () => {
    const tabs = [
      {
        label: "Consultations",
        label_hi: "परामर्श",
        href: "/consultations",
        description: "d",
        icon: "support_agent",
      },
    ];
    const sections = [{ key: "hero", enabled: true }];
    mockSupabase((path) => {
      if (path.includes("select=")) {
        return [
          { key: "public.nav_config", value: tabs },
          { key: "public.home_sections", value: sections },
        ];
      }
      return [];
    });
    const res = await app.request("/api/v1/settings", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { nav_config: unknown; home_sections: unknown } };
    expect(body.data.nav_config).toEqual(tabs);
    expect(body.data.home_sections).toEqual(sections);

    // unset in the DB → null, and the frontend falls back to checked-in NAV_TABS
    mockSupabase(() => []);
    const unset = await app.request("/api/v1/settings", {}, BINDINGS);
    const unsetBody = (await unset.json()) as {
      data: { nav_config: unknown; home_sections: unknown };
    };
    expect(unsetBody.data.nav_config).toBeNull();
    expect(unsetBody.data.home_sections).toBeNull();
  });

  it("degrades invalid/missing engine values to defaults with source map", async () => {
    mockSupabase(() => [{ key: "public.engine_ayanamsha", value: "not-a-thing" }]);
    const res = await app.request("/api/v1/settings", {}, BINDINGS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { engine: Record<string, string>; engine_sources: Record<string, string> };
    };
    expect(json.data.engine.ayanamsha).toBe("lahiri");
    expect(json.data.engine_sources.ayanamsha).toBe("invalid");
    expect(json.data.engine_sources.house_system).toBe("default");
  });

  it("500s when Supabase REST fails", async () => {
    globalThis.fetch = mock(
      async () => new Response("nope", { status: 401 }),
    ) as unknown as typeof fetch;
    const res = await app.request("/api/v1/settings", {}, BINDINGS);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("internal_error");
  });
});
