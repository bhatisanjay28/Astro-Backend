/**
 * Deterministic library-variant selection (library-structure.md §5).
 *
 *   v0 = FNV1a64(dateKey|sign|lang|slot|condition) mod N
 *   dodge repeats within the last 2 published days (daily only)
 *
 * Same inputs → same output (idempotent re-runs). Missing rows fall back to
 * the slot-family fallback templates, hash-spread the same way so the
 * ruleset §10.5 variety rule still holds.
 */

/** FNV-1a 64-bit hash (matches the library-structure §5 spec; uses BigInt). */
export function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

export interface LibraryRow {
  slot: string;
  condition: string;
  lang: string;
  variant_no: number;
  text: string;
  is_active: boolean;
}

export interface VariantPool {
  rows: LibraryRow[]; // active rows for (slot, condition, lang)
  fallback: string[]; // slot-family fallback templates (≥1)
}

export interface SelectionContext {
  dateKey: string; // period-scoped key: date / YYYY-MM / YYYY
  sign: string;
  lang: string;
  slot: string;
  condition: string;
  /** Already-published variant numbers for this (sign, slot, lang) on the previous 2 days. */
  recentVariants?: number[];
}

export function pickVariant(
  ctx: SelectionContext,
  pool: VariantPool,
): { text: string; variantNo: number | null; source: "library" | "fallback" } {
  const key = `${ctx.dateKey}|${ctx.sign}|${ctx.lang}|${ctx.slot}|${ctx.condition}`;
  const v0 = Number(fnv1a64(key) % BigInt(Math.max(1, pool.rows.length || pool.fallback.length)));

  if (pool.rows.length > 0) {
    const recent = new Set(ctx.recentVariants ?? []);
    for (let k = 0; k < pool.rows.length; k++) {
      const idx = (v0 + k) % pool.rows.length;
      const row = pool.rows[idx];
      if (!row) continue;
      if (recent.size > 0 && recent.has(row.variant_no) && k < pool.rows.length - 1) continue;
      return { text: row.text, variantNo: row.variant_no, source: "library" };
    }
  }

  // Fallback templates (library cell missing or empty)
  if (pool.fallback.length > 0) {
    const recent = new Set(ctx.recentVariants ?? []);
    const count = pool.fallback.length;
    for (let k = 0; k < count; k++) {
      const idx = (v0 + k) % count;
      if (recent.size > 0 && recent.has(1000 + idx) && k < count - 1) continue;
      return {
        text: pool.fallback[idx] ?? pool.fallback[0]!,
        variantNo: 1000 + idx,
        source: "fallback",
      };
    }
  }
  throw new Error(`no variants and no fallback for ${ctx.slot} / ${ctx.condition}`);
}
