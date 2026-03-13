/**
 * POST /api/auth — validate credentials and set session cookie.
 * Body: { username: string, password: string }
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const validUser = process.env.AUTH_USER;
  const validPass = process.env.AUTH_PASS;

  if (!validUser || !validPass) {
    // Auth not configured — shouldn't happen but allow through
    return NextResponse.json({ ok: true });
  }

  if (username !== validUser || password !== validPass) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const sessionValue = btoa(`${username}:${password}`);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90, // 90 days
  });

  return res;
}
