'use client';

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceChartProps {
  candles: Candle[];
  width?: number;
  height?: number;
  className?: string;
}

export function PriceChart({
  candles,
  width = 600,
  height = 280,
  className = '',
}: PriceChartProps) {
  if (candles.length < 2) return null;

  const padLeft = 58;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 48;
  const volHeight = 40;

  const chartW = width - padLeft - padRight;
  const priceH = height - padTop - padBottom - volHeight;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const priceMin = Math.min(...lows);
  const priceMax = Math.max(...highs);
  const priceRange = priceMax - priceMin || 1;
  const volMax = Math.max(...volumes) || 1;

  const isPositive = closes[closes.length - 1] >= candles[0].open;
  const lineColor = isPositive ? '#4ade80' : '#f87171';
  const fillColor = isPositive ? '#4ade8020' : '#f8717120';

  // Map candle index to x position
  function x(i: number) {
    return padLeft + (i / (candles.length - 1)) * chartW;
  }
  // Map price to y position
  function yPrice(p: number) {
    return padTop + (1 - (p - priceMin) / priceRange) * priceH;
  }
  // Map volume to y position (bottom area)
  function yVol(v: number) {
    const volTop = height - padBottom;
    return volTop - (v / volMax) * volHeight;
  }

  // Price line points
  const linePoints = closes.map((c, i) => `${x(i)},${yPrice(c)}`).join(' ');

  // Area fill path: line + close to bottom
  const areaPath = [
    `M ${x(0)},${yPrice(closes[0])}`,
    ...closes.slice(1).map((c, i) => `L ${x(i + 1)},${yPrice(c)}`),
    `L ${x(candles.length - 1)},${padTop + priceH}`,
    `L ${x(0)},${padTop + priceH}`,
    'Z',
  ].join(' ');

  // Y-axis ticks (5 levels)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const frac = i / 4;
    const price = priceMin + frac * priceRange;
    return { price, y: yPrice(price) };
  });

  // X-axis time labels — pick ~5 evenly spaced
  const timeLabels: { label: string; x: number }[] = [];
  const step = Math.max(1, Math.floor(candles.length / 5));
  for (let i = 0; i < candles.length; i += step) {
    const d = new Date(candles[i].time);
    const h = d.getHours();
    const m = d.getMinutes();
    const label = `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
    timeLabels.push({ label, x: x(i) });
  }

  // Volume bar width
  const barW = Math.max(1, chartW / candles.length - 1);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <line
          key={i}
          x1={padLeft}
          y1={t.y}
          x2={width - padRight}
          y2={t.y}
          stroke="#374151"
          strokeWidth="0.5"
        />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill={fillColor} />

      {/* Price line */}
      <polyline
        points={linePoints}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Volume bars */}
      {candles.map((c, i) => (
        <rect
          key={i}
          x={x(i) - barW / 2}
          y={yVol(c.volume)}
          width={barW}
          height={height - padBottom - yVol(c.volume)}
          fill={c.close >= c.open ? '#4ade8040' : '#f8717140'}
        />
      ))}

      {/* Y-axis labels */}
      {yTicks.map((t, i) => (
        <text
          key={i}
          x={padLeft - 6}
          y={t.y + 3}
          textAnchor="end"
          fill="#9ca3af"
          fontSize="10"
          fontFamily="monospace"
        >
          ${t.price.toFixed(2)}
        </text>
      ))}

      {/* X-axis labels */}
      {timeLabels.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={height - padBottom + 16}
          textAnchor="middle"
          fill="#6b7280"
          fontSize="10"
          fontFamily="monospace"
        >
          {t.label}
        </text>
      ))}

      {/* Current price dot */}
      <circle
        cx={x(candles.length - 1)}
        cy={yPrice(closes[closes.length - 1])}
        r="3"
        fill={lineColor}
      />

      {/* Current price label */}
      <text
        x={x(candles.length - 1) + 6}
        y={yPrice(closes[closes.length - 1]) + 4}
        fill={lineColor}
        fontSize="11"
        fontWeight="bold"
        fontFamily="monospace"
      >
        ${closes[closes.length - 1].toFixed(2)}
      </text>
    </svg>
  );
}
