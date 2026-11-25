/**
 * Admin Phase 2 — PII masking for roles without `inbox.read_pii`
 * (02-mary-gap-analysis §C: masked for content_editor + viewer; full PII for
 * super_admin, admin, booking_manager).
 *
 * Masking lives in the backend API layer, NOT RLS: the backend's
 * service-role key bypasses RLS entirely, so the route is the only
 * enforcement point that actually runs. Every read that returns full PII on
 * the detail endpoint is audited by the caller (inbox.read_pii audit action).
 */

export interface PiiMasked<T> {
  value: T;
  masked: boolean;
}

/** Keep the last 4 digits: "•••• 4255" (numbers are stored bare, no +91). */
export function maskPhone(phone: string | null): PiiMasked<string | null> {
  if (!phone) return { value: null, masked: false };
  const digits = phone.replace(/\D/g, "");
  return { value: digits.length > 4 ? `•••• ${digits.slice(-4)}` : "••••", masked: true };
}

/** Keep first character and domain: "s••••@gmail.com". */
export function maskEmail(email: string | null): PiiMasked<string | null> {
  if (!email) return { value: null, masked: false };
  const at = email.indexOf("@");
  if (at <= 0) return { value: "••••", masked: true };
  return { value: `${email[0]}••••${email.slice(at)}`, masked: true };
}

/**
 * Birth details are the most sensitive field (health/relationship concerns
 * often appear here) — masked to a marker, never partially shown. Only shown
 * with inbox.read_pii AND the submitter's explicit consent flag.
 * The column is jsonb (consultation_requests), so values may arrive as
 * objects — pass them through untouched when unmasked.
 */
export function maskBirthDetails(
  birthDetails: unknown,
  consent: boolean,
  fullPii: boolean,
): PiiMasked<unknown> {
  if (birthDetails === null || birthDetails === undefined) {
    return { value: null, masked: false };
  }
  if (fullPii && consent) return { value: birthDetails, masked: false };
  return { value: null, masked: true };
}

export type MaskedRow<T> = T & {
  /** true when any PII field was withheld for this role */
  pii_masked?: boolean;
};

/** Mask phone/email/birth details on a request row according to capability. */
export function maskRequestRow<T extends Record<string, unknown>>(
  row: T,
  fullPii: boolean,
  fields: { phone?: string; email?: string; birth?: string; consent?: string },
): MaskedRow<T> {
  const out: Record<string, unknown> = { ...row };
  let anyMasked = false;
  if (fields.phone && typeof row[fields.phone] !== "undefined") {
    // read_pii holders see the raw value; masking helpers only run for
    // masked roles (a booking manager must be able to call the seeker back)
    const m = fullPii
      ? { value: (row[fields.phone] as string | null) ?? null, masked: false }
      : maskPhone((row[fields.phone] as string | null) ?? null);
    out[fields.phone] = m.value;
    anyMasked ||= m.masked;
  }
  if (fields.email && typeof row[fields.email] !== "undefined") {
    const m = fullPii
      ? { value: (row[fields.email] as string | null) ?? null, masked: false }
      : maskEmail((row[fields.email] as string | null) ?? null);
    out[fields.email] = m.value;
    anyMasked ||= m.masked;
  }
  if (fields.birth && typeof row[fields.birth] !== "undefined") {
    const m = maskBirthDetails(
      row[fields.birth] ?? null,
      fields.consent ? Boolean(row[fields.consent]) : true,
      fullPii,
    );
    out[fields.birth] = m.value;
    anyMasked ||= m.masked;
  }
  return { ...out, pii_masked: anyMasked } as MaskedRow<T>;
}
