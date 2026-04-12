import { type NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Edge Middleware
 *
 * Responsibilities:
 * 1. Attach security headers to every response
 * 2. Redirect unauthenticated users away from protected routes
 * 3. Redirect authenticated users away from auth pages
 *
 * IMPORTANT: This file runs at the Edge — it MUST NOT import from `@/lib/`
 * because those modules depend on Node.js-only APIs (Prisma, ioredis, etc.).
 */

const SESSION_COOKIE = 'better-auth.session_token';

/**
 * Public paths that do NOT require authentication.
 * Static files and `_next` are already excluded by the matcher config below.
 */
const PUBLIC_PATH_PREFIXES = ['/api/', '/onboarding'] as const;
const AUTH_PATHS = ['/login', '/register'] as const;

function isPublicPath(pathname: string): boolean {
  // Exact match on landing page
  if (pathname === '/') return true;

  // Prefixed matches (API routes, onboarding wizard)
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }

  return false;
}

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function buildCsp(isDev: boolean): string {
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return directives.join('; ');
}

function applySecurityHeaders(
  response: NextResponse,
  isDev: boolean,
): NextResponse {
  const headers = response.headers;

  headers.set('Content-Security-Policy', buildCsp(isDev));
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), usb=(), payment=(), autoplay=()',
  );
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');

  // HSTS only in production — avoid poisoning the HSTS cache during local dev
  if (!isDev) {
    headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV === 'development';
  const hasSession = request.cookies.has(SESSION_COOKIE);

  // Authenticated users hitting the landing page → redirect to marketplace
  if (hasSession && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/marketplace';
    return applySecurityHeaders(NextResponse.redirect(url), isDev);
  }

  // Authenticated users hitting auth pages → redirect to marketplace
  if (hasSession && isAuthPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/marketplace';
    return applySecurityHeaders(NextResponse.redirect(url), isDev);
  }

  // Unauthenticated users hitting protected (dashboard) routes → redirect to login
  if (!hasSession && !isPublicPath(pathname) && !isAuthPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('callbackUrl', pathname);
    return applySecurityHeaders(NextResponse.redirect(url), isDev);
  }

  // All other requests — pass through with security headers
  return applySecurityHeaders(NextResponse.next(), isDev);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (static files)
     * - _next/image   (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - api/auth       (Better Auth handler — must be publicly reachable)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api/auth).*)',
  ],
};
