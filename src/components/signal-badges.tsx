/** Reusable score badge with color based on value */
export function ScoreBadge({ score }: { score: number }) {
  let bg = 'bg-gray-700';
  if (score >= 75) bg = 'bg-green-600';
  else if (score >= 50) bg = 'bg-yellow-600';
  else if (score >= 25) bg = 'bg-orange-600';
  else bg = 'bg-red-700';

  return (
    <span className={`${bg} text-white text-sm font-bold px-2.5 py-0.5 rounded-full`}>
      {score}
    </span>
  );
}

/** Format a percent change with + sign and color */
export function PctChange({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-600">—</span>;
  const color = value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-gray-400';
  const prefix = value > 0 ? '+' : '';
  return <span className={`${color} text-sm font-mono`}>{prefix}{value.toFixed(2)}%</span>;
}

/** Colored RVOL display */
export function RvolBadge({ rvol }: { rvol: number | null }) {
  if (rvol == null) return <span className="text-gray-600 text-sm">—</span>;
  let color = 'text-gray-400';
  if (rvol >= 3) color = 'text-green-400';
  else if (rvol >= 1.5) color = 'text-yellow-400';
  return <span className={`${color} text-sm font-mono`}>{rvol.toFixed(1)}x</span>;
}

/** VWAP status display */
export function VwapStatus({ pctFromVwap }: { pctFromVwap: number | null }) {
  if (pctFromVwap == null) return <span className="text-gray-600 text-sm">—</span>;
  const above = pctFromVwap > 0;
  return (
    <span className={`text-sm ${above ? 'text-green-400' : 'text-red-400'}`}>
      {above ? '▲' : '▼'} {Math.abs(pctFromVwap).toFixed(1)}%
    </span>
  );
}

/** News indicator dot */
export function NewsIndicator({ count }: { count: number }) {
  if (count === 0) return <span className="text-gray-600 text-sm">—</span>;
  return (
    <span className="text-yellow-400 text-sm font-mono">
      📰 {count}
    </span>
  );
}

/** Data availability indicator */
export function DataStatus({ status }: { status: string | null }) {
  if (!status || status === 'unavailable') {
    return <span className="text-gray-600 text-sm italic">N/A</span>;
  }
  if (status === 'available') {
    return <span className="text-green-500 text-sm">✓</span>;
  }
  return <span className="text-yellow-500 text-sm">Partial</span>;
}

/** Timestamp display */
export function TimeAgo({ date }: { date: string | Date }) {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return <span className="text-gray-500 text-sm">just now</span>;
  if (mins < 60) return <span className="text-gray-500 text-sm">{mins}m ago</span>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return <span className="text-gray-500 text-sm">{hrs}h ago</span>;
  return <span className="text-gray-500 text-sm">{d.toLocaleDateString()}</span>;
}

/** Format large numbers for float display */
export function FloatDisplay({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-600 text-sm">—</span>;
  if (value >= 1_000_000_000) return <span className="text-sm font-mono">{(value / 1_000_000_000).toFixed(1)}B</span>;
  if (value >= 1_000_000) return <span className="text-sm font-mono">{(value / 1_000_000).toFixed(1)}M</span>;
  return <span className="text-sm font-mono">{(value / 1000).toFixed(0)}K</span>;
}
