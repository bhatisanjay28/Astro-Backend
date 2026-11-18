/**
 * Lahiri (Chitrapaksha) ayanamsha — D5.
 *
 * Method: linear precession from the J2000 anchor.
 *   Lahiri ayanamsha at J2000.0 (2000-01-01 12:00 TT) = 23°51′11.04″ = 23.853044°
 *   General precession in longitude ≈ 50.2564″/year.
 * Accuracy vs published Lahiri tables ≈ ±0.5′ across 1900–2100 — sufficient for
 * Panchang display in Phase 1; refine with a table/interpolation before public
 * launch if the owner requires arc-minute fidelity (tracked in Epic 1.6).
 */
const J2000_JD = 2451545.0; // JD (TT ≈ UT for this precision)
const AYANAMSHA_J2000_DEG = 23.853044;
const PRECESSION_ARCSEC_PER_YEAR = 50.2564;

export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5; // Unix epoch → JD (UT)
}

export function yearsSinceJ2000(date: Date): number {
  return (julianDay(date) - J2000_JD) / 365.25;
}

/** Lahiri ayanamsha in degrees for the given instant. */
export function lahiriAyanamsha(date: Date): number {
  return AYANAMSHA_J2000_DEG + (PRECESSION_ARCSEC_PER_YEAR * yearsSinceJ2000(date)) / 3600;
}

/** Tropical longitude → sidereal longitude (normalised 0–360). */
export function toSidereal(tropicalLonDeg: number, date: Date): number {
  const lon = tropicalLonDeg - lahiriAyanamsha(date);
  return ((lon % 360) + 360) % 360;
}
