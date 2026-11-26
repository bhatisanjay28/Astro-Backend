/**
 * Free-text search terms fed into PostgREST `ilike.*…*` filters —
 * inbox-style sanitisation shared by the media and tags lists (phase-3
 * review P2): operator characters `( ) * , \` would otherwise change the
 * meaning of the filter expression (encodeURIComponent does not escape
 * them), and the length cap keeps long probes out of the query string.
 */
export function safeQuery(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/[(),*\\]/g, " ")
    .trim()
    .slice(0, 80);
}
