/**
 * POST /api/poll — manual poll trigger from the UI.
 * No auth required (intended for local/interactive use).
 * For automated/external cron, use /api/cron/poll with CRON_SECRET.
 */

import { NextResponse } from 'next/server';
import { runPollingCycle } from '@/lib/jobs';

export async function POST() {
  try {
    const result = await runPollingCycle('manual');
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Poll] Manual polling cycle failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
