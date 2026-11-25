/**
 * Admin Phase 2 — the single source of truth for inbox status transitions
 * (03-winston-architecture §4). Every inbox PATCH validates through here
 * before touching the database.
 *
 * Rules the owner specified verbatim:
 *  - "once closed, no contacted/scheduled options again" — closed/cancelled
 *    are terminal; no transition map entry uses them as a source.
 *  - "verification/validation before closing so no re-open needed" — a
 *    request can only reach `closed` after POST /verify has stamped
 *    verified_at; a verified request can never be re-opened.
 *  - Reschedule is NOT a state: while `scheduled`, PATCH scheduled_for in
 *    place (same-status PATCH is a no-op transition, so it stays allowed).
 */

export type RequestStatus =
  | "new"
  | "contacted"
  | "scheduled"
  | "completed"
  | "closed"
  | "cancelled";

export type MessageStatus = "new" | "read" | "closed" | "cancelled";

export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ["contacted", "scheduled", "cancelled", "closed"],
  contacted: ["scheduled", "completed", "cancelled", "closed"],
  scheduled: ["completed", "cancelled", "closed"],
  // reopen to scheduled is allowed only BEFORE verification (asserted below)
  completed: ["closed", "scheduled"],
  closed: [],
  cancelled: [],
};

export const MESSAGE_TRANSITIONS: Record<MessageStatus, MessageStatus[]> = {
  new: ["read", "closed", "cancelled"],
  read: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

/** 409-class failure with a message the admin UI can show as-is. */
export class TransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function assertStep<T extends string>(
  map: Record<T, T[]>,
  from: string,
  to: string,
  what: string,
): void {
  const sources = Object.keys(map) as T[];
  if (!sources.includes(from as T)) {
    throw new TransitionError("invalid_status", `Unknown current status "${from}" on ${what}.`);
  }
  if (from === to) return; // same-status PATCH (e.g. reschedule) is a no-op
  const allowed = map[from as T];
  if (!allowed || !allowed.includes(to as T)) {
    throw new TransitionError(
      "invalid_transition",
      `A ${what} cannot move from "${from}" to "${to}".`,
    );
  }
}

/**
 * Validate a consultation/puja request transition.
 * @param verified whether the row already has verified_at set
 */
export function assertRequestTransition(from: string, to: string, verified: boolean): void {
  assertStep(REQUEST_TRANSITIONS, from, to, "request");
  if (from !== to) {
    if (to === "closed" && !verified) {
      throw new TransitionError("verification_required", "Verify this request before closing it.");
    }
    if (from === "completed" && to === "scheduled" && verified) {
      throw new TransitionError(
        "invalid_transition",
        "A verified request cannot be re-opened for scheduling.",
      );
    }
  }
}

export function assertMessageTransition(from: string, to: string): void {
  assertStep(MESSAGE_TRANSITIONS, from, to, "message");
}

/** Which statuses each list tab can pre-filter with (UI chips mirror this). */
export const REQUEST_STATUS_LIST = Object.keys(REQUEST_TRANSITIONS) as RequestStatus[];
export const MESSAGE_STATUS_LIST = Object.keys(MESSAGE_TRANSITIONS) as MessageStatus[];
