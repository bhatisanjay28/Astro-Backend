/**
 * seed-cities.ts — one-time (rerunnable) worldwide city seed from GeoNames.
 *
 * Owner directive 2026-11-20: the birthplace pickers must offer "all places/
 * cities", not a hand-picked list. This script upserts:
 *   - cities5000.txt  → every populated place worldwide with pop ≥ 5,000
 *   - IN.txt          → Indian populated places with pop ≥ 1,000 (towns and
 *                       larger villages, where most Indian birthplaces are)
 * into the Supabase `cities` table, keyed on the existing UNIQUE geonames_id
 * column (merge-duplicates: existing rows keep their slugs, which panchang
 * URLs depend on).
 *
 * Data © GeoNames (https://www.geonames.org), licensed CC BY 4.0.
 *
 * Usage (from backend/):  bun scripts/seed-cities.ts <dump-dir> [--dry]
 * Env (backend/.env):     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Dump files expected:    cities5000.txt IN.txt admin1CodesASCII.txt
 *                         countryInfo.txt
 */
const dumpDir = process.argv[2];
const dry = process.argv.includes("--dry");
if (!dumpDir) {
  console.error("Usage: bun scripts/seed-cities.ts <dump-dir> [--dry]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dry && (!url || !key)) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (backend/.env)");
  process.exit(1);
}

interface CityRow {
  geonames_id: number;
  slug?: string;
  name: string;
  admin1: string | null;
  country_code: string;
  country: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number;
  search_names: string | null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function readLines(file: string): string[] {
  return Bun.file(`${dumpDir}/${file}`)
    .text()
    .then((t) => t.split("\n"));
}

// --- reference maps -----------------------------------------------------------
const countryName = new Map<string, string>();
for (const line of await readLines("countryInfo.txt")) {
  if (line.startsWith("#")) continue;
  const f = line.split("\t");
  if (f[0]) countryName.set(f[0], f[4] ?? "");
}
const admin1Name = new Map<string, string>();
for (const line of await readLines("admin1CodesASCII.txt")) {
  const f = line.split("\t");
  if (f[0]) admin1Name.set(f[0], f[1] ?? "");
}

// --- existing rows (preserve slugs) ------------------------------------------
const usedSlugs = new Set<string>();
const existingIds = new Map<number, string>(); // geonames_id → current slug
const slugBySlug = new Map<string, string>(); // slug → itself (lookup)
if (!dry) {
  // PostgREST caps a single response (Supabase: 1000 rows) — paginate.
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      select: "geonames_id,slug",
      order: "slug.asc",
      limit: "1000",
      offset: String(offset),
    });
    const res = await fetch(`${url}/rest/v1/cities?${params.toString()}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`fetch existing cities failed: ${res.status}`);
    const page = (await res.json()) as Array<{ geonames_id: number | null; slug: string }>;
    for (const row of page) {
      usedSlugs.add(row.slug);
      slugBySlug.set(row.slug, row.slug);
      if (row.geonames_id != null) existingIds.set(row.geonames_id, row.slug);
    }
    if (page.length < 1000) break;
    offset += 1000;
  }
  console.log(`existing rows: ${existingIds.size}`);
}

// --- parse dumps --------------------------------------------------------------
// GeoNames row layout (19 tab-separated cols): 1 id, 2 name, 3 asciiname,
// 4 alternatenames, 5 lat, 6 lng, 7 class, 8 code, 9 country, 11 admin1,
// 15 population, 18 timezone.
const byId = new Map<number, CityRow>();

function addRow(f: string[]): boolean {
  const id = Number(f[0]);
  const pop = Number(f[14] || 0);
  const lat = Number(f[4]);
  const lng = Number(f[5]);
  const cc = f[8];
  const tz = f[17];
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng) || !cc || !tz) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (byId.has(id)) return false; // cities5000 wins over the IN supplement
  const name = (f[2] || f[1] || "").trim(); // prefer ASCII name (searchable)
  if (!name) return false;
  const admin1Code = f[10] ?? "";
  const admin1 = admin1Name.get(`${cc}.${admin1Code}`) ?? null;
  // capped alternate names → search_names (exonyms, romanizations, scripts)
  const alts = (f[3] ?? "").split(",").filter((a) => a.trim() && a.trim() !== name);
  const search = Array.from(new Set([name, ...alts.slice(0, 12)]))
    .join(" ")
    .slice(0, 300);
  byId.set(id, {
    geonames_id: id,
    name,
    admin1,
    country_code: cc,
    country: countryName.get(cc) ?? null,
    latitude: lat,
    longitude: lng,
    timezone: tz,
    population: pop,
    search_names: search,
  });
  return true;
}

let world = 0;
for (const line of await readLines("cities5000.txt")) {
  if (addRow(line.split("\t"))) world++;
}
let india = 0;
for (const line of await readLines("IN.txt")) {
  const f = line.split("\t");
  if (f[6] === "P" && Number(f[14] || 0) >= 1000 && addRow(f)) india++;
}
console.log(`world rows: ${world}, india supplement: ${india}, total: ${byId.size}`);

// --- slugs / conflict routing -------------------------------------------------
// Every POSTed row carries a slug (PostgREST bulk upserts reject missing NOT
// NULL keys). Three routes per row:
//   gid-match  → on_conflict=geonames_id, slug = existing DB slug (unchanged)
//   slug-match → on_conflict=slug, same city by name (e.g. "dubai") — row is
//                enriched in place (population, country, search_names)
//   insert     → on_conflict=geonames_id with a fresh unique slug
interface SeedRow extends CityRow {
  conflict: "geonames_id" | "slug";
}
// Bigger places claim plain slugs first: two Geonames entries can share a
// name (Jaipur city-proper vs Jaipur district; London UK vs Canada). ONE
// owner per slug — via its own gid (gid-match) or by taking over the existing
// row's slug (slug-match) — everyone else gets a suffixed slug.
const ordered = Array.from(byId.values()).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
const seedRows: SeedRow[] = [];
const claimGid = new Map<string, number>(); // slug → owning gid
const takeSlug = (slug: string): string => {
  usedSlugs.add(slug);
  return slug;
};
for (const row of ordered) {
  const id = row.geonames_id;
  const existing = existingIds.get(id);
  if (existing !== undefined && (!claimGid.has(existing) || claimGid.get(existing) === id)) {
    claimGid.set(existing, id);
    seedRows.push({ ...row, slug: takeSlug(existing), conflict: "geonames_id" });
    continue;
  }
  const base = slugify(row.name) || "city";
  if (slugBySlug.has(base) && !claimGid.has(base)) {
    // take over the same-named DB row (this entry outranks it or the DB row's
    // geonames_id is from an older vintage); upsert on slug rewrites the row
    claimGid.set(base, id);
    seedRows.push({ ...row, slug: takeSlug(base), conflict: "slug" });
    continue;
  }
  const a1 = slugify(row.admin1 ?? "");
  const candidates = [
    ...(existing === undefined ? [base] : []), // a gid-match loser's base is claimed
    a1 ? `${base}-${a1}` : null,
    `${base}-${row.country_code.toLowerCase()}`,
    `${base}-${id}`,
  ];
  let slug = `${base}-${id}`;
  for (const cand of candidates) {
    if (cand && !usedSlugs.has(cand) && !claimGid.has(cand)) {
      slug = cand;
      break;
    }
  }
  seedRows.push({ ...row, slug: takeSlug(slug), conflict: "geonames_id" });
}
// safety net: every generated slug must be globally unique before any POST
{
  const seen = new Set<string>();
  for (const r of seedRows) {
    if (!r.slug || seen.has(r.slug)) {
      throw new Error(`duplicate slug generated: ${r.slug} (gid ${r.geonames_id})`);
    }
    seen.add(r.slug);
  }
}
if (process.env.SEED_DEBUG) {
  const watch = ["Jaipur", "Suzhou", "Panaji", "London"];
  for (const name of watch) {
    for (const r of seedRows.filter((s) => s.name === name)) {
      console.log(
        `debug: ${name} gid=${r.geonames_id} pop=${r.population} slug=${r.slug} route=${r.conflict}`,
      );
    }
  }
}

// --- upsert ------------------------------------------------------------------
const BATCH = 500;
let ok = 0;
async function upsertBatch(items: SeedRow[], conflict: string, tag: string) {
  if (items.length === 0 || dry) return items.length;
  const params = new URLSearchParams({ on_conflict: conflict });
  const payload = items.map(({ conflict: _conflict, ...row }) => row);
  const res = await fetch(`${url}/rest/v1/cities?${params.toString()}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`upsert ${tag} failed: ${res.status} ${body.slice(0, 400)}`);
  }
  return items.length;
}
for (let i = 0; i < seedRows.length; i += BATCH) {
  const slice = seedRows.slice(i, i + BATCH);
  const gid: SeedRow[] = [];
  const bySlug: SeedRow[] = [];
  for (const r of slice) (r.conflict === "slug" ? bySlug : gid).push(r);
  ok += await upsertBatch(gid, "geonames_id", `gid:${Math.floor(i / BATCH)}`);
  ok += await upsertBatch(bySlug, "slug", `slug:${Math.floor(i / BATCH)}`);
  if (Math.floor(i / BATCH) % 20 === 0) console.log(`... ${ok}/${seedRows.length}`);
}
console.log(`done: ${ok}/${seedRows.length} rows upserted${dry ? " (dry run)" : ""}`);
