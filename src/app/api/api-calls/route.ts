import { NextResponse } from 'next/server';
import { getApiCallLog } from '@/lib/twelvedata';

export async function GET() {
  return NextResponse.json(getApiCallLog());
}
