import { describe, expect, it } from "bun:test";
import { canTransition, readingMinutes, slugify, validatePostInput } from "../src/lib/posts";

/** QA-mindset: boundaries (empty/zero/one/many), malformed input, transitions. */

describe("slugify", () => {
  it("lowercases, folds accents and collapses separators", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Vedic -- Astrology 101 ")).toBe("vedic-astrology-101");
    expect(slugify("Crème brûlée")).toBe("creme-brulee");
    expect(slugify("Shani's Sade Sati")).toBe("shanis-sade-sati");
  });

  it("returns empty for non-Latin input (callers fall back)", () => {
    expect(slugify("राशिफल आज")).toBe("");
    expect(slugify("")).toBe("");
    expect(slugify("---")).toBe("");
  });

  it("truncates very long input", () => {
    const out = slugify("a".repeat(300));
    expect(out.length).toBeLessThanOrEqual(96);
  });
});

describe("readingMinutes", () => {
  it("minimum 1 minute even for empty/near-empty content", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("one two three")).toBe(1);
  });
  it("200 words ≈ 1 minute, 600 ≈ 3", () => {
    const w200 = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const w600 = Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ");
    expect(readingMinutes(w200)).toBe(1);
    expect(readingMinutes(w600)).toBe(3);
  });
});

describe("validatePostInput", () => {
  const good = {
    title: "A Post",
    content_md: "# Hi\n\nBody text here.",
  };

  it("create: title+content are required; status defaults to draft", () => {
    const ok = validatePostInput(good, "create");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.fields.status).toBe("draft");
  });

  it("create: missing title or content_md fails with field errors", () => {
    for (const missing of ["title", "content_md"] as const) {
      const bad = { ...good };
      delete bad[missing];
      const res = validatePostInput(bad, "create");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.some((e) => e.field === missing)).toBe(true);
    }
  });

  it("rejects malformed slug, bad URLs, overlong excerpt, bad status, bad publish_at", () => {
    const res = validatePostInput(
      {
        ...good,
        slug: "Not A Slug!",
        status: "scheduled",
        publish_at: "not-a-date",
        excerpt: "x".repeat(501),
        canonical_url: "ftp://nope",
      },
      "create",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const fields = res.errors.map((e) => e.field);
      for (const f of ["slug", "status", "publish_at", "excerpt", "canonical_url"]) {
        expect(fields).toContain(f);
      }
    }
  });

  it("rejects publishing with future publish_at (schedule instead)", () => {
    const res = validatePostInput(
      { ...good, status: "published", publish_at: new Date(Date.now() + 86_400_000).toISOString() },
      "create",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === "publish_at")).toBe(true);
  });

  it("dedupes tags, enforces max 10 and slug shape", () => {
    const ok = validatePostInput({ ...good, tags: ["vedic", "vedic", "panchang"] }, "create");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.fields.tags).toEqual(["vedic", "panchang"]);

    const tooMany = validatePostInput(
      { ...good, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      "create",
    );
    expect(tooMany.ok).toBe(false);

    const badShape = validatePostInput({ ...good, tags: ["Vedic!"] }, "create");
    expect(badShape.ok).toBe(false);
  });

  it("update: only provided fields are returned", () => {
    const res = validatePostInput({ excerpt: "new excerpt" }, "update");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Object.keys(res.fields)).toEqual(["excerpt"]);
    }
  });
});

describe("canTransition", () => {
  it("allows the editorial flow and blocks the rest", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("draft", "archived")).toBe(true);
    expect(canTransition("published", "draft")).toBe(true); // unpublish
    expect(canTransition("published", "archived")).toBe(true);
    expect(canTransition("archived", "published")).toBe(true);
    expect(canTransition("archived", "draft")).toBe(false);
  });
});
