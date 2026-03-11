import { SignalDetailClient } from './signal-detail-client';

export const dynamic = 'force-dynamic';

export default async function SignalDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return <SignalDetailClient symbol={symbol.toUpperCase()} />;
}
