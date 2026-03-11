'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface MiniChartProps {
  data: number[];
  timestamps?: string[];
  width?: number;
  height?: number;
  className?: string;
}

export function MiniChart({
  data,
  timestamps,
  width = 300,
  height = 120,
  className = '',
}: MiniChartProps) {
  if (data.length < 2) return null;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number]>([0, 1]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Visible data slice based on zoom level
  const zStart = Math.floor(zoom[0] * (data.length - 1));
  const zEnd = Math.ceil(zoom[1] * (data.length - 1));
  const visData = data.slice(zStart, Math.max(zStart + 2, zEnd + 1));
  const visTimes = timestamps?.slice(zStart, Math.max(zStart + 2, zEnd + 1));

  const hasXAxis = visTimes && visTimes.length === visData.length;
  const padLeft = 50;
  const padRight = 6;
  const padTop = 10;
  const padBottom = hasXAxis ? 22 : 6;

  // Gentler font scaling so hero card labels stay readable
  const ts = Math.pow(400 / width, 0.7);
  const fontY = Math.max(9, 11 * ts);
  const fontX = Math.max(8, 10 * ts);
  const fontTip = Math.max(10, 12 * ts);

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const min = Math.min(...visData);
  const max = Math.max(...visData);
  const range = max - min || 1;

  const isPositive = visData[visData.length - 1] >= visData[0];
  const lineColor = isPositive ? '#4ade80' : '#f87171';
  const fillColor = isPositive ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)';

  function x(i: number) {
    return padLeft + (i / (visData.length - 1)) * chartW;
  }
  function y(v: number) {
    return padTop + (1 - (v - min) / range) * chartH;
  }

  const linePoints = visData.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  const areaPath = [
    `M ${x(0)},${y(visData[0])}`,
    ...visData.slice(1).map((v, i) => `L ${x(i + 1)},${y(v)}`),
    `L ${x(visData.length - 1)},${padTop + chartH}`,
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
      const screenX = e.clientX - rect.left;
      const fraction = (screenX / rect.width - padLeft / width) / (chartW / width);
      const idx = Math.round(fraction * (visData.length - 1));
      setHoverIndex(Math.max(0, Math.min(visData.length - 1, idx)));
    },
    [width, padLeft, chartW, visData.length],
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
        (sx / rect.width * width - padLeft) / (width - padLeft - 6)
      ));
      setZoom(([s, en]) => {
        const r = en - s;
        const factor = e.deltaY > 0 ? 1.2 : 0.85;
        const minRange = Math.max(0.05, 3 / (data.length || 1));
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
  }, [width, data.length]);

  // Tooltip position clamping
  const showTime = hasXAxis && visTimes;
  const tipW = (showTime ? 78 : 58) * ts;
  const tipH = (showTime ? 30 : 18) * ts;
  const hIdx = Math.min(hoverIndex ?? 0, visData.length - 1);
  const hx = x(hIdx);
  const hy = y(visData[hIdx]);
  let tipX = hx - tipW / 2;
  if (tipX < padLeft) tipX = padLeft;
  if (tipX + tipW > width - padRight) tipX = width - padRight - tipW;
  let tipY = hy - tipH - 6;
  if (tipY < 2) tipY = hy + 6;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={() => setZoom([0, 1])}
      style={{ touchAction: 'none', width: '100%', height: '100%' }}
      preserveAspectRatio="xMidYMid meet"
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
            fontSize={fontY}
          >
            ${fmt(t.value)}
          </text>
        </g>
      ))}

      {/* X-axis time labels */}
      {hasXAxis && (() => {
        const n = visData.length;
        const targetLabels = width > 500 ? 5 : 3;
        const step = Math.max(1, Math.floor(n / targetLabels));
        const indices: number[] = [];
        for (let i = 0; i < n; i += step) indices.push(i);
        if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);
        return indices.map((i) => {
          const d = new Date(visTimes![i]);
          const label = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
          return (
            <text
              key={i}
              x={x(i)}
              y={padTop + chartH + 14}
              textAnchor="middle"
              fill="#6b7280"
              fontSize={fontX}
            >
              {label}
            </text>
          );
        });
      })()}

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
        cx={x(visData.length - 1)}
        cy={y(visData[visData.length - 1])}
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
            y={tipY + (showTime ? tipH * 0.38 : tipH / 2 + 3.5)}
            textAnchor="middle"
            fill="#e5e7eb"
            fontSize={fontTip}
            fontWeight="600"
          >
            ${fmt(visData[hIdx])}
          </text>
          {showTime && visTimes && (
            <text
              x={tipX + tipW / 2}
              y={tipY + tipH * 0.75}
              textAnchor="middle"
              fill="#9ca3af"
              fontSize={fontTip * 0.8}
            >
              {(() => { const d = new Date(visTimes[hIdx]); return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`; })()}
            </text>
          )}
        </g>
      )}

      {/* Invisible hit-area so pointer events register across full chart */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
      />
    </svg>
  );
}
