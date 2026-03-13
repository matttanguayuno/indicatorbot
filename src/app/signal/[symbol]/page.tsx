import { Suspense } from 'react';
import { SignalDetailClient } from './signal-detail-client';

export const dynamic = 'force-dynamic';

export default async function SignalDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return (
    <Suspense fallback={<div className="text-center text-gray-500 py-12">Loading...</div>}>
      <SignalDetailClient symbol={symbol.toUpperCase()} />
    </Suspense>
  );
}
