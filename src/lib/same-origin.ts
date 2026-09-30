/**
 * Refuses a cross-site POST outright. The console's forms and the page's typed
 * messages post to their own origin only; the console's session cookie is also
 * SameSite=Strict. Not authentication: it stops another site from driving these
 * endpoints from a visitor's browser.
 */
export function sameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}
