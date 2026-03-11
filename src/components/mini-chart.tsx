'use client';

interface MiniChartProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function MiniChart({
  data,
  width = 120,
  height = 40,
  className = '',
}: MiniChartProps) {
  if (data.length < 2) return null;

  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const isPositive = data[data.length - 1] >= data[0];
  const lineColor = isPositive ? '#4ade80' : '#f87171';
  const fillColor = isPositive ? '#4ade8018' : '#f8717118';

  function x(i: number) {
    return pad + (i / (data.length - 1)) * (width - pad * 2);
  }
  function y(v: number) {
    return pad + (1 - (v - min) / range) * (height - pad * 2);
  }

  const linePoints = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  const areaPath = [
    `M ${x(0)},${y(data[0])}`,
    ...data.slice(1).map((v, i) => `L ${x(i + 1)},${y(v)}`),
    `L ${x(data.length - 1)},${height - pad}`,
    `L ${x(0)},${height - pad}`,
    'Z',
  ].join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <path d={areaPath} fill={fillColor} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(data.length - 1)}
        cy={y(data[data.length - 1])}
        r="2"
        fill={lineColor}
      />
    </svg>
  );
}
