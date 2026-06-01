import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const requireAuth: string[] = [
  "/chat",
  "/api",
  "/reporting",
  "/unauthorized",
  "/agent",
  "/persona",
  "/prompt"
];
const requireAdmin: string[] = ["/reporting"];

export async function proxy(request: NextRequest) {
  const res = NextResponse.next();
  const pathname = request.nextUrl.pathname;

  // /embed/* may be framed by allow-listed ancestors. EMBED_ALLOWED_ANCESTORS is
  // resolved here at RUNTIME (proxy runs per request) so it can change via an env
  // var without a rebuild — next.config.js headers() are baked at build time.
  // Defaults to 'self' only; the embed feature is opt-in per deployment. No
  // X-Frame-Options: it has no allow-list semantics and CSP supersedes it.
  if (pathname.startsWith("/embed")) {
    const frameAncestors = (
      process.env.EMBED_ALLOWED_ANCESTORS || "'self'"
    ).trim();
    res.headers.set(
      "Content-Security-Policy",
      `frame-ancestors ${frameAncestors};`,
    );
    return res;
  }

  // Check if the user is trying to access the root path
  if (pathname === '/') {
    const token = await getToken({
      req: request,
    });

    // If the user is logged in, redirect to /chat
    if (token) {
      const url = new URL(`/chat`, request.url);
      return NextResponse.redirect(url);
    }
  }

  if (requireAuth.some((path) => pathname.startsWith(path))) {
    const token = await getToken({
      req: request,
    });

    // Check not logged in
    if (!token) {
      const url = new URL(`/`, request.url);
      return NextResponse.redirect(url);
    }

    if (requireAdmin.some((path) => pathname.startsWith(path))) {
      // Check if not authorized
      if (!token.isAdmin) {
        const url = new URL(`/unauthorized`, request.url);
        return NextResponse.rewrite(url);
      }
    }
  }

  return res;
}

// note that middleware is not applied to api/auth as this is required to logon (i.e. requires anon access)
export const config = {
  matcher: [
    "/",
    "/embed/:path*",
    "/unauthorized/:path*",
    "/reporting/:path*",
    "/api/chat:path*",
    "/api/images:path*",
    "/chat/:path*",
    "/agent/:path*",
    "/persona/:path*",
  ],
};
