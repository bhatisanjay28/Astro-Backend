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
