import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const user = process.env.AUTH_USER;
  const pass = process.env.AUTH_PASS;

  // Skip auth if credentials aren't configured
  if (!user || !pass) return NextResponse.next();

  // Check session cookie
  const session = req.cookies.get('session')?.value;
  if (session) {
    // Validate: cookie value is base64(user:pass)
    try {
      const decoded = atob(session);
      const [u, p] = decoded.split(':');
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    } catch { /* invalid cookie, fall through to redirect */ }
  }

  // Also accept Basic Auth header (for cron jobs / API clients)
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      try {
        const decoded = atob(encoded);
        const [u, p] = decoded.split(':');
        if (u === user && p === pass) {
          return NextResponse.next();
        }
      } catch { /* invalid header */ }
    }
  }

  // Redirect to login page
  const loginUrl = new URL('/login', req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json|sw.js|icons/|login|api/auth).*)'],
};
