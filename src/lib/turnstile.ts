/**
 * Cloudflare Turnstile verification (admin brief: "bot protection") for the
 * anonymous write endpoints — /auth/login, /requests/consultation,
 * /requests/puja, /newsletter. The widget secret lives in the
 * TURNSTILE_SECRET_KEY binding; when it is unset the check passes so local
 * dev, the test suite and the arming window behave exactly as before. The
 * browser side only ever holds the public sitekey; siteverify runs here with
 * the caller IP (same fallback chain as the rate limiter in app.ts).
 */
export function verifyTurnstile(
  token: unknown,
  ip: string,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return Promise.resolve(true);
  if (typeof token !== "string" || token.length === 0) {
    return Promise.resolve(false);
  }
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  return fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
    // A hung siteverify must not hold an anonymous write endpoint open until
    // the Workers runtime cap — abort converts to fail-closed below.
    signal: AbortSignal.timeout(5000),
  })
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as { success?: boolean };
      return data.success === true;
    })
    .catch(() => false);
}

/** Standard 400 payload for a failed bot check. */
export function captchaRequired(): { error: { code: string; message: string } } {
  return {
    error: {
      code: "captcha_required",
      message: "Bot verification failed — please reload the page and try again.",
    },
  };
}
