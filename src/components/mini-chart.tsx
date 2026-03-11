'use client';

import { useState, useCallback, useRef } from 'react';

interface MiniChartProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function MiniChart({
  data,
  width = 300,
  height = 120,
  className = '',
}: MiniChartProps) {
  if (data.length < 2) return null;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const padLeft = 50;
  const padRight = 6;
  const padTop = 10;
  const padBottom = 6;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const isPositive = data[data.length - 1] >= data[0];
  const lineColor = isPositive ? '#4ade80' : '#f87171';
  const fillColor = isPositive ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)';

  function x(i: number) {
    return padLeft + (i / (data.length - 1)) * chartW;
  }
  function y(v: number) {
    return padTop + (1 - (v - min) / range) * chartH;
  }

  const linePoints = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  const areaPath = [
    `M ${x(0)},${y(data[0])}`,
    ...data.slice(1).map((v, i) => `L ${x(i + 1)},${y(v)}`),
    `L ${x(data.length - 1)},${padTop + chartH}`,
    `L ${x(0)},${padTop + chartH}`,
    'Z',
  ].join(' ');

  // Y-axis: 3 ticks (low, mid, high)
  const yTicks = [0, 0.5, 1].map((pct) => {
    const value = min + pct * range;
    return { value, yPos: y(value) };
  });

  function fmt(v: number) {
    if (v >= 1000) return v.toFixed(0);
    if (v >= 100) return v.toFixed(1);
    return v.toFixed(2);
  }

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * width;
      const idx = Math.round(((mouseX - padLeft) / chartW) * (data.length - 1));
      setHoverIndex(Math.max(0, Math.min(data.length - 1, idx)));
    },
    [width, padLeft, chartW, data.length],
  );

  const handlePointerLeave = useCallback(() => setHoverIndex(null), []);

  // Tooltip position clamping
  const tipW = 58;
  const tipH = 18;
  const hIdx = hoverIndex ?? 0;
  const hx = x(hIdx);
  const hy = y(data[hIdx]);
  let tipX = hx - tipW / 2;
  if (tipX < padLeft) tipX = padLeft;
  if (tipX + tipW > width - padRight) tipX = width - padRight - tipW;
  let tipY = hy - tipH - 6;
  if (tipY < 2) tipY = hy + 6;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{ touchAction: 'none' }}
    >
      {/* Y-axis grid lines + labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padLeft}
            y1={t.yPos}
            x2={width - padRight}
            y2={t.yPos}
            stroke="#374151"
            strokeWidth="0.5"
            strokeDasharray="3,3"
          />
          <text
            x={padLeft - 5}
            y={t.yPos + 3}
            textAnchor="end"
            fill="#6b7280"
            fontSize="9"
          >
            ${fmt(t.value)}
          </text>
        </g>
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

      {/* Current price dot */}
      <circle
        cx={x(data.length - 1)}
        cy={y(data[data.length - 1])}
        r="2.5"
        fill={lineColor}
      />

      {/* Hover crosshair + tooltip */}
      {hoverIndex != null && (
        <g>
          {/* Vertical crosshair */}
          <line
            x1={hx}
            y1={padTop}
            x2={hx}
            y2={padTop + chartH}
            stroke="#9ca3af"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
          {/* Horizontal crosshair */}
          <line
            x1={padLeft}
            y1={hy}
            x2={width - padRight}
            y2={hy}
            stroke="#9ca3af"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
          {/* Dot on line */}
          <circle
            cx={hx}
            cy={hy}
            r="3.5"
            fill={lineColor}
            stroke="#111827"
            strokeWidth="1.5"
          />
          {/* Tooltip box */}
          <rect
            x={tipX}
            y={tipY}
            width={tipW}
            height={tipH}
            rx="3"
            fill="#111827"
            stroke="#4b5563"
            strokeWidth="0.5"
          />
          <text
            x={tipX + tipW / 2}
            y={tipY + tipH / 2 + 3.5}
            textAnchor="middle"
            fill="#e5e7eb"
            fontSize="10"
            fontWeight="600"
          >
            ${fmt(data[hIdx])}
          </text>
        </g>
      )}

      {/* Invisible hit-area so pointer events register across full chart */}
      <rect
        x={padLeft}
        y={padTop}
        width={chartW}
        height={chartH}
        fill="transparent"
      />
    </svg>
  );
}
