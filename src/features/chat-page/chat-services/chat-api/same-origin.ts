import "server-only";

/**
 * CSRF defense: refuse a request whose Origin (or Referer fallback) does
 * not match the request URL's host. NextAuth's SameSite=Lax cookies still
 * permit top-level form submissions from evil.com, so we enforce this on
 * every state-changing chat route handler.
 *
 * Returns a 403 Response when the request fails the check; returns null
 * when it's same-origin (caller continues normally).
 */
export function enforceSameOriginRequest(req: Request): Response | null {
  const requestUrl = new URL(req.url);
  // Behind Azure App Service (and most reverse proxies) `req.url` carries
  // the internal hostname while the browser's Origin/Referer carries the
  // public one — comparing them directly 403s every request. Trust
  // `X-Forwarded-Host` when present; App Service overwrites any
  // client-supplied value at the edge, so this is not a CSRF bypass.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const expectedHost = forwardedHost ?? requestUrl.host;

  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return new Response("Bad Origin header", { status: 403 });
    }
    if (originHost !== expectedHost) {
      return new Response("Cross-origin request refused", { status: 403 });
    }
    return null;
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== expectedHost) {
        return new Response("Cross-origin request refused", { status: 403 });
      }
      return null;
    } catch {
      return new Response("Bad Referer header", { status: 403 });
    }
  }

  return new Response("Missing Origin/Referer", { status: 403 });
}
