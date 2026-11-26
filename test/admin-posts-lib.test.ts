import { describe, expect, it } from "bun:test";
import {
  canTransition,
  readingMinutes,
  sanitizeDeep,
  sanitizeMarkdown,
  slugify,
  validatePostInput,
} from "../src/lib/posts";

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

describe("sanitizeMarkdown (save-time scrub — owner brief)", () => {
  it("strips scriptable tags outright", () => {
    expect(sanitizeMarkdown("hello <script>alert(1)</script> world")).toBe("hello  world");
    expect(sanitizeMarkdown('<iframe src="https://x.example"></iframe>')).toBe("");
    expect(sanitizeMarkdown("<object></object><embed><form></form>")).toBe("");
    // closing tag without an opening one is removed too
    expect(sanitizeMarkdown("</script>text")).toBe("text");
  });

  it("strips on* event-handler attributes", () => {
    expect(sanitizeMarkdown('<img src="a.png" onerror="alert(1)">')).toBe('<img src="a.png">');
    expect(sanitizeMarkdown("<b onclick='x()'>hi</b>")).toBe("<b>hi</b>");
    expect(sanitizeMarkdown('<a href="#" onmouseover = "p()">x</a>')).toBe('<a href="#">x</a>');
  });

  it("neutralises javascript:/vbscript: URLs", () => {
    expect(sanitizeMarkdown("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))"); // md syntax is inert — render layer handles it
    expect(sanitizeMarkdown('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
    expect(sanitizeMarkdown("<a href='vbscript:x'>y</a>")).toBe('<a href="#">y</a>');
    expect(sanitizeMarkdown("<img src=javascript:alert(1)>")).toBe('<img src="#">');
  });

  it("leaves normal Markdown and benign inline HTML untouched", () => {
    const md = [
      "# Heading",
      "",
      "A [link](https://vyotish.com) and **bold** text.",
      "",
      "```html",
      "<b>code fence content is NOT executable</b>",
      "```",
      "",
      "- item one",
      "- item two",
      "",
      'Inline <em>emphasis</em> and <img src="/media/x.png" alt="x"> stay.',
    ].join("\n");
    expect(sanitizeMarkdown(md)).toBe(md);
  });

  it("runs inside validatePostInput so create and update both sanitise", () => {
    const res = validatePostInput(
      { title: "t", content_md: "<script>x</script>body", status: "draft" },
      "create",
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fields.content_md).toBe("body");
  });
});

describe("sanitizeDeep (phase-3 story [R9])", () => {
  it("scrubs string values at any depth, keys untouched", () => {
    const out = sanitizeDeep({
      title: "<script>alert(1)</script>Safe",
      nested: { body: "<iframe src=javascript:x></iframe>text", keep: 5 },
      arr: ["<b>ok</b>", { deep: "onerror=payload" }],
    }) as Record<string, unknown>;
    expect(out.title).toBe("Safe");
    expect((out.nested as Record<string, unknown>).keep).toBe(5);
    expect((out.nested as Record<string, unknown>).body).toBe("text");
    expect((out.arr as string[])[0]).toBe("<b>ok</b>");
  });

  it("passes through non-strings (numbers, booleans, nulls)", () => {
    expect(sanitizeDeep({ n: 3, b: true, z: null })).toEqual({ n: 3, b: true, z: null });
    expect(sanitizeDeep("plain")).toBe("plain");
  });
});

describe("lang validation (migration 0017, story [R2])", () => {
  it("accepts en/hi and rejects anything else", () => {
    const en = validatePostInput({ title: "t", content_md: "c", lang: "en" }, "update");
    expect(en.ok).toBe(true);
    if (en.ok) expect(en.fields.lang).toBe("en");
    const hi = validatePostInput({ title: "t", content_md: "c", lang: "hi" }, "update");
    expect(hi.ok).toBe(true);
    if (hi.ok) expect(hi.fields.lang).toBe("hi");
    const bad = validatePostInput({ title: "t", content_md: "c", lang: "fr" }, "update");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.field).toBe("lang");
  });

  it("omitting lang on create leaves it to the DB default", () => {
    const res = validatePostInput({ title: "t", content_md: "c" }, "create");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fields.lang).toBeUndefined();
  });
});

describe("publish_at explicit clear (phase-3 review P2)", () => {
  it('maps "" and null to an explicit null so the editor can unschedule', () => {
    for (const cleared of ["", null]) {
      const res = validatePostInput({ publish_at: cleared }, "update");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.fields.publish_at).toBeNull();
    }
  });

  it("still validates real timestamps and rejects garbage", () => {
    const good = validatePostInput({ publish_at: "2026-01-01T10:00:00Z" }, "update");
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.fields.publish_at).toBe("2026-01-01T10:00:00.000Z");
    const bad = validatePostInput({ publish_at: "not-a-date" }, "update");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.field).toBe("publish_at");
  });

  it("omitting publish_at still means undefined (no change)", () => {
    const res = validatePostInput({}, "update");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fields.publish_at).toBeUndefined();
  });
});
