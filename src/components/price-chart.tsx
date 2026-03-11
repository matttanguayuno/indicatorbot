'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

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
  width = 900,
  height = 350,
  className = '',
}: PriceChartProps) {
  if (candles.length < 2) return null;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number]>([0, 1]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Visible candles based on zoom level
  const zStart = Math.floor(zoom[0] * (candles.length - 1));
  const zEnd = Math.ceil(zoom[1] * (candles.length - 1));
  const visCandles = candles.slice(zStart, Math.max(zStart + 2, zEnd + 1));

  const padLeft = 52;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 28;
  const volHeight = 32;

  const chartW = width - padLeft - padRight;
  const priceH = height - padTop - padBottom - volHeight;

  const closes = visCandles.map((c) => c.close);
  const highs = visCandles.map((c) => c.high);
  const lows = visCandles.map((c) => c.low);
  const volumes = visCandles.map((c) => c.volume);

  const priceMin = Math.min(...lows);
  const priceMax = Math.max(...highs);
  const priceRange = priceMax - priceMin || 1;
  const volMax = Math.max(...volumes) || 1;

  const isPositive = closes[closes.length - 1] >= visCandles[0].open;
  const lineColor = isPositive ? '#4ade80' : '#f87171';
  const fillColor = isPositive ? '#4ade8020' : '#f8717120';

  function x(i: number) {
    return padLeft + (i / (visCandles.length - 1)) * chartW;
  }
  function yPrice(p: number) {
    return padTop + (1 - (p - priceMin) / priceRange) * priceH;
  }
  function yVol(v: number) {
    const volTop = height - padBottom;
    return volTop - (v / volMax) * volHeight;
  }

  const linePoints = closes.map((c, i) => `${x(i)},${yPrice(c)}`).join(' ');

  const areaPath = [
    `M ${x(0)},${yPrice(closes[0])}`,
    ...closes.slice(1).map((c, i) => `L ${x(i + 1)},${yPrice(c)}`),
    `L ${x(visCandles.length - 1)},${padTop + priceH}`,
    `L ${x(0)},${padTop + priceH}`,
    'Z',
  ].join(' ');

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const frac = i / 4;
    const price = priceMin + frac * priceRange;
    return { price, y: yPrice(price) };
  });

  const timeLabels: { label: string; x: number }[] = [];
  const step = Math.max(1, Math.floor(visCandles.length / 5));
  for (let i = 0; i < visCandles.length; i += step) {
    const d = new Date(visCandles[i].time);
    const h = d.getHours();
    const m = d.getMinutes();
    const label = `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
    timeLabels.push({ label, x: x(i) });
  }

  const barW = Math.max(1, chartW / visCandles.length - 1);

  function fmtPrice(v: number) {
    if (v >= 1000) return v.toFixed(0);
    if (v >= 100) return v.toFixed(1);
    return v.toFixed(2);
  }

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const fraction = (screenX / rect.width - padLeft / width) / (chartW / width);
      const idx = Math.round(fraction * (visCandles.length - 1));
      setHoverIndex(Math.max(0, Math.min(visCandles.length - 1, idx)));
    },
    [width, padLeft, chartW, visCandles.length],
  );

  const handlePointerLeave = useCallback(() => setHoverIndex(null), []);

  // Mouse wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const frac = Math.max(0, Math.min(1,
        (sx / rect.width * width - padLeft) / (width - padLeft - 8)
      ));
      setZoom(([s, en]) => {
        const r = en - s;
        const factor = e.deltaY > 0 ? 1.2 : 0.85;
        const minRange = Math.max(0.05, 3 / (candles.length || 1));
        const nr = Math.min(1, Math.max(minRange, r * factor));
        const center = s + frac * r;
        let ns = center - frac * nr;
        let ne = center + (1 - frac) * nr;
        if (ns < 0) { ne = Math.min(1, ne - ns); ns = 0; }
        if (ne > 1) { ns = Math.max(0, ns - (ne - 1)); ne = 1; }
        return [ns, ne];
      });
      setHoverIndex(null);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, candles.length]);

  // Hover tooltip position
  const hIdx = Math.min(hoverIndex ?? 0, visCandles.length - 1);
  const hx = x(hIdx);
  const hy = yPrice(closes[hIdx]);
  const tipW = 70;
  const tipH = 28;
  let tipX = hx - tipW / 2;
  if (tipX < padLeft) tipX = padLeft;
  if (tipX + tipW > width - padRight) tipX = width - padRight - tipW;
  let tipY = hy - tipH - 8;
  if (tipY < 2) tipY = hy + 8;

  // Hover time label
  const hoverTime = hoverIndex != null ? (() => {
    const d = new Date(visCandles[hIdx].time);
    const h = d.getHours();
    const m = d.getMinutes();
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
  })() : '';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={() => setZoom([0, 1])}
      style={{ touchAction: 'none', width: '100%', height: '100%' }}
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
      {visCandles.map((c, i) => (
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
          x={padLeft - 5}
          y={t.y + 3}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={12}
        >
          ${t.price.toFixed(2)}
        </text>
      ))}

      {/* X-axis labels */}
      {timeLabels.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={height - padBottom + 12}
          textAnchor="middle"
          fill="#6b7280"
          fontSize={11}
        >
          {t.label}
        </text>
      ))}

      {/* Current price dot */}
      <circle
        cx={x(visCandles.length - 1)}
        cy={yPrice(closes[closes.length - 1])}
        r="3"
        fill={lineColor}
      />

      {/* Current price label */}
      <text
        x={x(visCandles.length - 1) + 5}
        y={yPrice(closes[closes.length - 1]) + 3}
        fill={lineColor}
        fontSize={11}
        fontWeight="bold"
      >
        ${closes[closes.length - 1].toFixed(2)}
      </text>

      {/* Hover crosshair + tooltip */}
      {hoverIndex != null && (
        <g>
          <line x1={hx} y1={padTop} x2={hx} y2={height - padBottom} stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2,2" />
          <line x1={padLeft} y1={hy} x2={width - padRight} y2={hy} stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2,2" />
          <circle cx={hx} cy={hy} r="3.5" fill={lineColor} stroke="#111827" strokeWidth="1.5" />
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="3" fill="#111827" stroke="#4b5563" strokeWidth="0.5" />
          <text x={tipX + tipW / 2} y={tipY + 11} textAnchor="middle" fill="#e5e7eb" fontSize={12} fontWeight="600">
            ${fmtPrice(closes[hIdx])}
          </text>
          <text x={tipX + tipW / 2} y={tipY + 22} textAnchor="middle" fill="#9ca3af" fontSize={10}>
            {hoverTime}
          </text>
        </g>
      )}

      {/* Full-area hit target */}
      <rect x={0} y={0} width={width} height={height} fill="transparent" />
    </svg>
  );
}
