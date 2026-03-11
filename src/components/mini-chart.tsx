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
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Visible data slice based on zoom level
  const zStart = Math.floor(zoom[0] * (data.length - 1));
  const zEnd = Math.ceil(zoom[1] * (data.length - 1));
  const visData = data.slice(zStart, Math.max(zStart + 2, zEnd + 1));
  const visTimes = timestamps?.slice(zStart, Math.max(zStart + 2, zEnd + 1));

  const hasXAxis = visTimes && visTimes.length === visData.length;

  // Scale padding/strokes proportionally to viewBox width, but clamp font sizes
  // so they stay readable on both small (300px) and large (900px) viewBoxes
  const scale = width / 400;
  const padLeft = Math.round(50 * scale);
  const padRight = Math.round(8 * scale);
  const padTop = Math.round(10 * scale);
  const padBottom = hasXAxis ? Math.round(22 * scale) : Math.round(6 * scale);

  // Font sizes: scale gently (sqrt) so they don't balloon on wide viewBoxes
  const fontScale = Math.sqrt(scale);
  const fontY = 11 * fontScale;
  const fontX = 10 * fontScale;
  const fontTip = 12 * fontScale;

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

  const calcIndex = useCallback(
    (clientX: number) => {
      if (!svgRef.current) return null;
      const rect = svgRef.current.getBoundingClientRect();
      const screenX = clientX - rect.left;
      const fraction = (screenX / rect.width - padLeft / width) / (chartW / width);
      const idx = Math.round(fraction * (visData.length - 1));
      if (idx < 0 || idx >= visData.length) return null;
      return idx;
    },
    [width, padLeft, chartW, visData.length],
  );

  // Desktop: show tooltip on hover
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === 'touch') return;
      const idx = calcIndex(e.clientX);
      setHoverIndex(idx);
    },
    [calcIndex],
  );

  const handlePointerLeave = useCallback(() => setHoverIndex(null), []);

  // Mobile: horizontal swipe shows data points, vertical scroll still works
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isHorizontalSwipe = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isHorizontalSwipe = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      // Once we determine direction, lock it in
      if (!isHorizontalSwipe && dx < 8 && dy < 8) return;
      if (!isHorizontalSwipe) {
        isHorizontalSwipe = dx > dy;
      }
      if (isHorizontalSwipe) {
        e.preventDefault(); // prevent vertical scroll during horizontal swipe
        const idx = calcIndex(e.touches[0].clientX);
        setHoverIndex(idx);
      }
    };

    const onTouchEnd = () => {
      // Clear tooltip after a short delay so user can see the last value
      setTimeout(() => setHoverIndex(null), 1500);
      isHorizontalSwipe = false;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [calcIndex]);

  // Mouse wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const frac = Math.max(0, Math.min(1,
        (sx / rect.width * width - padLeft) / (width - padLeft - padRight)
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
  }, [width, padLeft, padRight, data.length]);

  // Touch pinch-to-zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    let pinchStartDist = 0;
    let pinchStartZoom: [number, number] = [0, 1];
    let pinchFrac = 0.5;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      pinchStartDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      pinchStartZoom = [...zoomRef.current] as [number, number];
      const rect = el.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      pinchFrac = Math.max(0, Math.min(1,
        (cx / rect.width * width - padLeft) / (width - padLeft - padRight),
      ));
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDist === 0) return;
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      const ratio = pinchStartDist / dist;
      const [s0, e0] = pinchStartZoom;
      const r0 = e0 - s0;
      const minRange = Math.max(0.05, 3 / (data.length || 1));
      const nr = Math.min(1, Math.max(minRange, r0 * ratio));
      const center = s0 + pinchFrac * r0;
      let ns = center - pinchFrac * nr;
      let ne = center + (1 - pinchFrac) * nr;
      if (ns < 0) { ne = Math.min(1, ne - ns); ns = 0; }
      if (ne > 1) { ns = Math.max(0, ns - (ne - 1)); ne = 1; }
      setZoom([ns, ne]);
      setHoverIndex(null);
    };

    const onTouchEnd = () => { pinchStartDist = 0; };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [width, padLeft, padRight, data.length]);

  // Tooltip position clamping
  const showTime = hasXAxis && visTimes;
  const tipW = (showTime ? 80 : 58) * fontScale;
  const tipH = (showTime ? 38 : 20) * fontScale;
  const hIdx = Math.min(hoverIndex ?? 0, visData.length - 1);
  const hx = x(hIdx);
  const hy = y(visData[hIdx]);
  let tipX = hx - tipW / 2;
  if (tipX < padLeft) tipX = padLeft;
  if (tipX + tipW > width - padRight) tipX = width - padRight - tipW;
  let tipY = hy - tipH - 6 * fontScale;
  if (tipY < 2 * fontScale) tipY = hy + 6 * fontScale;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={() => setZoom([0, 1])}
      style={{ touchAction: 'pan-y', width: '100%', height: '100%' }}
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
            strokeWidth={0.5 * scale}
            strokeDasharray={`${3 * scale},${3 * scale}`}
          />
          <text
            x={padLeft - 5 * scale}
            y={t.yPos + fontY * 0.35}
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
              y={padTop + chartH + 14 * scale}
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
        strokeWidth={1.5 * scale}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Current price dot */}
      <circle
        cx={x(visData.length - 1)}
        cy={y(visData[visData.length - 1])}
        r={2.5 * scale}
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
            strokeWidth={0.5 * scale}
            strokeDasharray={`${2 * scale},${2 * scale}`}
          />
          {/* Horizontal crosshair */}
          <line
            x1={padLeft}
            y1={hy}
            x2={width - padRight}
            y2={hy}
            stroke="#9ca3af"
            strokeWidth={0.5 * scale}
            strokeDasharray={`${2 * scale},${2 * scale}`}
          />
          {/* Dot on line */}
          <circle
            cx={hx}
            cy={hy}
            r={3.5 * scale}
            fill={lineColor}
            stroke="#111827"
            strokeWidth={1.5 * scale}
          />
          {/* Tooltip box */}
          <rect
            x={tipX}
            y={tipY}
            width={tipW}
            height={tipH}
            rx={3 * fontScale}
            fill="#111827"
            stroke="#4b5563"
            strokeWidth={0.5 * fontScale}
          />
          <text
            x={tipX + tipW / 2}
            y={tipY + (showTime ? tipH * 0.38 : tipH * 0.6)}
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
              y={tipY + tipH * 0.76}
              textAnchor="middle"
              fill="#9ca3af"
              fontSize={fontTip * 0.78}
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
