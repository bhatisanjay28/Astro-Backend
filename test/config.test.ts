import { describe, expect, it } from "bun:test";
import app from "../src/app";
import {
  DEFAULT_ENGINE_CONFIG,
  ENGINE_CONFIG_ALLOWED,
  ENGINE_CONFIG_KEYS,
  type EngineConfig,
  engineConfigProblems,
  resolveEngineConfig,
} from "../src/engine/config";

describe("engine config resolution (Epic 1.9)", () => {
  it("yields defaults when no DB values exist", () => {
    const { config, sources } = resolveEngineConfig(undefined);
    expect(config).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(Object.values(sources).every((s) => s === "default")).toBe(true);
  });

  it("applies DB values and marks their source", () => {
    const { config, sources } = resolveEngineConfig({
      ayanamsha: "lahiri",
      month_system: "amanta",
      house_system: "whole_sign",
      chart_style: "south_indian",
    });
    expect(config.month_system).toBe("amanta");
    expect(config.chart_style).toBe("south_indian");
    expect(sources.month_system).toBe("db");
    expect(sources.chart_style).toBe("db");
    expect(sources.ayanamsha).toBe("db");
  });

  it("degrades invalid DB values to defaults flagged as invalid", () => {
    const { config, sources } = resolveEngineConfig({
      ayanamsha: "raman",
      month_system: 42,
      chart_style: undefined,
    });
    expect(config).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(sources.ayanamsha).toBe("invalid");
    expect(sources.month_system).toBe("invalid");
    expect(sources.house_system).toBe("default");
    expect(sources.chart_style).toBe("default");
  });

  it("strict validation: unknown keys and unsupported values are problems", () => {
    const problems = engineConfigProblems({ ayanamsha: "raman", foo: "bar" });
    expect(problems).toHaveLength(2);
    expect(problems[0]?.allowed).toEqual(["lahiri"]);
    expect(problems[1]?.problem).toBe("unknown engine option");
    expect(engineConfigProblems(undefined)).toEqual([]);
    expect(engineConfigProblems({ ayanamsha: "lahiri", month_system: "purnimanta" })).toEqual([]);
  });

  it("allowed-value table covers every config key", () => {
    for (const key of ENGINE_CONFIG_KEYS) {
      expect(ENGINE_CONFIG_ALLOWED[key].length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("POST /api/v1/kundli engine options (Epic 1.9)", () => {
  const base = {
    date: "1990-05-15",
    time: "10:00",
    lat: 28.6139,
    lng: 77.209,
    tz: "Asia/Kolkata",
  };

  it("accepts valid options and echoes the resolved config", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, options: { chart_style: "south_indian" } }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { meta: { engine_config: EngineConfig } };
    expect(json.meta.engine_config.chart_style).toBe("south_indian");
    expect(json.meta.engine_config.ayanamsha).toBe("lahiri");
    expect(json.meta.engine_config.house_system).toBe("whole_sign");
  });

  it("rejects unsupported option values with 400 + allowed lists", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, options: { ayanamsha: "krishnamurti" } }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { details: Array<{ allowed: string[] }> } };
    expect(json.error.details[0]?.allowed).toEqual(["lahiri"]);
  });

  it("rejects unknown option keys", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, options: { houseSystem: "placidus" } }),
    });
    expect(res.status).toBe(400);
  });
});
