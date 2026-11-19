# Vyotish Calculation Engine (`src/engine/`)

Epic 1 — versioned, pure-function calculation core. **Zero I/O**: no fetch, no DB,
no environment access. The backend routes call it; nothing else does.

## Modules

| Module           | Contents                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ayanamsha.ts`   | Lahiri (Chitrapaksha) ayanamsha; tropical→sidereal conversion                                                                                                 |
| `bodies.ts`      | astronomy-engine wrapper: sun/moon tropical+sidereal longitudes, elongation, sunrise/sunset/moonrise/moonset                                                  |
| `nodes.ts`       | Mean Rahu/Ketu (Meeus 47.7 — the traditional mean-node convention)                                                                                            |
| `finders.ts`     | Wrap-aware bisection: when a cyclic longitude reaches a target                                                                                                |
| `panchang.ts`    | Five limbs (tithi/nakshatra/yoga/karana) as start/end windows in the sunrise-based Vedic day; Rahu Kaal/Yamaganda/Gulika/Abhijit/Brahma Muhurta; moonrise/set |
| `kundli.ts`      | Nine grahas, Lagna, whole-sign houses, Navamsha (D9)                                                                                                          |
| `dasha.ts`       | Vimshottari Maha-dasha with balance-at-birth                                                                                                                  |
| `calculators.ts` | Moon phase, tropical sun sign, Rashi/nakshatra, Chaldean numerology                                                                                           |
| `names.ts`       | Sanskrit name tables (30 tithis, 27 nakshatras ×2 languages, 27 yogas, 60→11 karanas, day-segment tables)                                                     |

## Accuracy notes (PRD §8)

**Validated against (see `test/engine.test.ts`, `test/kundli.test.ts`,
`test/calculators.test.ts`):**

1. **Ayanamsha** vs published Lahiri tables: 2026 ≈ 24°14′ ✓ (±0.08°), 1950 ≈ 23°09′ ✓.
   Method: linear precession from the J2000 anchor 23°51′11″ @ 50.2564″/yr.
   Known limit: ±0.5′ vs full tables across 1900–2100 — adequate for display;
   table interpolation is the upgrade path if arc-minute fidelity is demanded.
2. **Sankranti anchor**: sun enters sidereal Capricorn on 2026-01-14/15 IST ✓.
3. **Elongation** cross-checked against astronomy-engine's own new/full-moon search
   instants (±0.5°) ✓.
4. **Sunrise**: Delhi 2026-01-01 → 07:13 IST (published almanacs: 07:12–07:14) ✓.
5. **Ascendant**: at the sunrise instant the ASC trails the Sun's tropical centre by
   ≈1° across Delhi/London/Sydney — the physically-expected offset from the
   upper-limb/refraction sunrise definition ✓.
6. **Navamsha**: continuous (sign×9+part) scheme unit-tested against the classical
   movable/fixed/dual start rules ✓.

**Deliberate conventions (documented choices):**

- Vedic day = sunrise → next sunrise (PRD §5.3).
- Sunrise = upper limb + refraction (astronomy-engine standard; matches almanacs).
- Limb windows list every occurrence inside the Vedic day with instants.
- **Rahu Kaal / Yamaganda / Gulika** use the widely-published proportional 1/8-day
  tables; responses carry `verified: false` + source note until a qualified Jyotishi
  reviews them (**P11 — launch blocker**).
- Mean (not true) lunar node — the traditional convention; true-node is a config
  option if the Jyotishi review prefers it.

**Determinism & caching:** everything is a pure function of (time, coordinates) →
panchang/kundli responses are cacheable per (city, date). `engine_version` is stamped
on every response.

## Matching module (`matching.ts` — Epic 1.8, PRD §5.5)

Ashtakoota (36-guna milan) + Manglik dosha over two kundli inputs.

- **Koota maxima**: varna 1 · vashya 2 · tara 3 · yoni 4 · graha-maitri 5 ·
  gana 6 · bhakoot 7 · nadi 8 = 36; accept ≥ 18.
- **Tables**: half-sign vashya (exact Moon longitude), yoni animals with the
  unpaired mongoose (Uttara Ashadha), 7 enemy pairs, classical planetary
  friendship (Moon enemyless), gana cross-scores (same 6 / deva–manushya 5 /
  deva–rakshasa 1 / manushya–rakshasa 0), bhakoot dosha pairs 2/12 · 5/9 ·
  6/8 with the mutual-friend-lords cancellation, nadi same → 0.
- **Manglik**: Mars in houses 1, 2, 4, 7, 8, 12 from Lagna, Moon AND Venus;
  cancelled when Mars is in Aries/Scorpio (own) or Capricorn (exalted).
- **Verification status: `verified: false` (P11 launch blocker)** — the
  school-dependent tables (gana cross-scores, yoni enemy matrix, vashya
  bhakshya, manglik cancellation list) follow the most widely published
  variant and are unit-tested for internal consistency only (self-match
  identity, recomputation cross-checks, 24-month manglik invariants). A
  qualified Jyotishi must sign off before launch; every response carries the
  `verified` flag.

## Transits & divisionals (`transits.ts`, `divisionals.ts` — Epic 1.10)

**Sade Sati** (natal Moon vs Saturn transit):

- Window = Saturn's FIRST entry into the 12th-from-Moon sign → FINAL exit from
  the 2nd-from-Moon sign (published-table presentation); mid-window retro
  excursions outside the trio (≤ ~6 months) do not end the window — an exit is
  final only when Saturn stays out ≥ 200 days.
- Instants from Saturn's true sidereal longitude via 20-day sampling + minute
  bisection. EXTERNAL ANCHOR: for an Aquarius-moon chart the computed window
  2020-01-24 → 2028-02-23 matches the published Capricorn-ingress /
  Aries-ingress dates exactly.
- Phase from the instantaneous offset (11/0/1 → 1/2/3); a mid-window retro dip
  reports phase 3 (classical presentation keeps the last phase).
- `verified: false` (P11) — definition choices need Jyotishi sign-off.

**Divisional charts (Parashari vargas)** over sidereal longitude:

- D3 drekkana (self/5th/9th), D7 saptamsha (odd→self, even→7th), D9 navamsha
  (continuous, identical to kundli.navamshaSignIndex — sync-tested),
  D10 dashamsha (odd→self, even→9th), D12 dwadashamsha (always self).
- Exposed per graha + Lagna on POST /api/v1/kundli as `divisionals`.
