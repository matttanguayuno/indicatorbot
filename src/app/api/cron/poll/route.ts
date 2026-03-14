/**
 * POST /api/cron/poll — trigger a polling cycle.
 * Protected by CRON_SECRET to prevent unauthorized access.
 * Can be called by Render cron jobs or internal scheduler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPollingCycle } from '@/lib/jobs';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runPollingCycle('cron');
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] Polling cycle failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
