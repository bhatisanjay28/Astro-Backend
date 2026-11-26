/**
 * Shared CF Pages deploy-hook ping (build trigger for the static frontend,
 * which re-bakes build-time SSR on rebuild). The horoscope cron pings after
 * a publishing run; the admin nav route pings after a nav config save so
 * the build-time merge (frontend scripts/ sync) picks up the new DB keys.
 *
 * Contract: fire-and-forget — a hook failure is logged, never thrown (the
 * next push-triggered deploy catches up).
 */
export async function pingFrontendDeployHook(
  url: string,
  reason: { source: "cron" | "nav_save"; published?: number },
): Promise<void> {
  try {
    const body =
      reason.source === "cron"
        ? { horoscope: { published: reason.published ?? 0 } }
        : { nav_save: true };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log(`[deploy-hook] pinged (${reason.source}): ${res.status}`);
  } catch (err) {
    console.error(`[deploy-hook] ping failed (${reason.source}):`, err);
  }
}
