'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { PatternResult } from '@/lib/types';

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
  patterns?: PatternResult[];
  highlightPatternIndex?: number | null;
  onPatternClick?: (index: number) => void;
  width?: number;
  height?: number;
  className?: string;
}

export function PriceChart({
  candles,
  patterns,
  highlightPatternIndex,
  onPatternClick,
  width: defaultW = 900,
  height: defaultH = 350,
  className = '',
}: PriceChartProps) {
  if (candles.length < 2) return null;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number]>([0, 1]);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startZoom: [number, number] } | null>(null);
  const [vSize, setVSize] = useState<[number, number]>([defaultW, defaultH]);

  // ResizeObserver: viewBox = CSS pixels so font sizes are real screen pixels
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setVSize([w, h]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = vSize[0];
  const height = vSize[1];

  // Visible candles based on zoom level
  const zStart = Math.floor(zoom[0] * (candles.length - 1));
  const zEnd = Math.ceil(zoom[1] * (candles.length - 1));
  const visCandles = candles.slice(zStart, Math.max(zStart + 2, zEnd + 1));

  const padLeft = 56;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 24;
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

  // Determine whether data spans multiple days to decide label format
  const firstTime = new Date(visCandles[0].time).getTime();
  const lastTime = new Date(visCandles[visCandles.length - 1].time).getTime();
  const spanMs = Math.abs(lastTime - firstTime);
  const spanDays = spanMs / 86_400_000;
  const multiDay = spanDays > 1.5;

  function fmtTimeLabel(d: Date): string {
    if (multiDay) {
      const mt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
      return `${mt.getMonth() + 1}/${mt.getDate()}`;
    }
    const mt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const h = mt.getHours();
    const m = mt.getMinutes();
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
  }

  const timeLabels: { label: string; x: number }[] = [];
  const step = Math.max(1, Math.floor(visCandles.length / 6));
  for (let i = 0; i < visCandles.length; i += step) {
    timeLabels.push({ label: fmtTimeLabel(new Date(visCandles[i].time)), x: x(i) });
  }

  const barW = Math.max(1, chartW / visCandles.length - 1);

  function fmtPrice(v: number) {
    if (v >= 1000) return v.toFixed(0);
    if (v >= 100) return v.toFixed(1);
    return v.toFixed(2);
  }

  const isZoomed = zoom[0] > 0 || zoom[1] < 1;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isZoomed) return;
      dragRef.current = { startX: e.clientX, startZoom: [...zoom] as [number, number] };
      svgRef.current?.setPointerCapture(e.pointerId);
      setHoverIndex(null);
    },
    [isZoomed, zoom],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();

      // Drag-to-pan when zoomed
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const pxRange = rect.width * (1 - padLeft / width - padRight / width);
        const zoomRange = dragRef.current.startZoom[1] - dragRef.current.startZoom[0];
        const shift = -(dx / pxRange) * zoomRange;
        let ns = dragRef.current.startZoom[0] + shift;
        let ne = dragRef.current.startZoom[1] + shift;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > 1) { ns -= (ne - 1); ne = 1; }
        setZoom([Math.max(0, ns), Math.min(1, ne)]);
        return;
      }

      // Hover tooltip
      const screenX = e.clientX - rect.left;
      const fraction = (screenX / rect.width - padLeft / width) / (chartW / width);
      const idx = Math.round(fraction * (visCandles.length - 1));
      setHoverIndex(Math.max(0, Math.min(visCandles.length - 1, idx)));
    },
    [width, padLeft, padRight, chartW, visCandles.length, zoom],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragRef.current) {
        svgRef.current?.releasePointerCapture(e.pointerId);
        dragRef.current = null;
      }
    },
    [],
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
  const tipW = 110;
  const tipH = 34;
  let tipX = hx - tipW / 2;
  if (tipX < padLeft) tipX = padLeft;
  if (tipX + tipW > width - padRight) tipX = width - padRight - tipW;
  let tipY = hy - tipH - 8;
  if (tipY < 2) tipY = hy + 8;

  // Hover time label
  const hoverTime = hoverIndex != null ? (() => {
    const d = new Date(visCandles[hIdx].time);
    const mt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    if (multiDay) {
      return `${mt.getMonth() + 1}/${mt.getDate()}/${mt.getFullYear()} ${mt.getHours() % 12 || 12}:${mt.getMinutes().toString().padStart(2, '0')}${mt.getHours() >= 12 ? 'p' : 'a'}`;
    }
    const h = mt.getHours();
    const m = mt.getMinutes();
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
  })() : '';

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }}>
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={(e) => { handlePointerUp(e); handlePointerLeave(); }}
      onDoubleClick={() => setZoom([0, 1])}
      style={{ touchAction: 'none', width: '100%', height: '100%', cursor: isZoomed ? 'grab' : 'crosshair' }}
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

      {/* Pattern overlays */}
      {patterns?.map((p, pi) => {
        // Map global candle indices to visible indices
        const vStart = p.startIndex - zStart;
        const vEnd = p.endIndex - zStart;
        // Skip patterns outside visible range
        if (vEnd < 0 || vStart >= visCandles.length) return null;
        const clampedStart = Math.max(0, vStart);
        const clampedEnd = Math.min(visCandles.length - 1, vEnd);

        const isHighlighted = highlightPatternIndex === pi;
        const dimmed = highlightPatternIndex != null && !isHighlighted;
        const patternColor = isHighlighted ? '#fbbf24' : '#facc15'; // brighter yellow when highlighted
        const patternFill = isHighlighted ? '#fbbf2440' : dimmed ? '#facc1508' : '#facc1518';
        const strokeW = isHighlighted ? 2 : 1;
        const opacity = dimmed ? 0.3 : 1;
        const gProps = {
          opacity,
          style: { cursor: onPatternClick ? 'pointer' : undefined } as React.CSSProperties,
          onClick: onPatternClick ? (e: React.MouseEvent) => { e.stopPropagation(); onPatternClick(pi); } : undefined,
        };

        switch (p.type) {
          case 'volume-breakout': {
            const ry = yPrice(p.resistancePrice);
            return (
              <g key={pi} {...gProps}>
                <line x1={x(clampedStart)} y1={ry} x2={x(clampedEnd)} y2={ry}
                  stroke={patternColor} strokeWidth={strokeW} strokeDasharray="4,3" />
                <text x={x(clampedEnd) + 4} y={ry - 4} fill={patternColor} fontSize={10} fontWeight="600">
                  {p.label}
                </text>
                {/* Triangle marker at breakout */}
                <polygon
                  points={`${x(clampedEnd)},${ry - 8} ${x(clampedEnd) - 4},${ry} ${x(clampedEnd) + 4},${ry}`}
                  fill={patternColor}
                />
              </g>
            );
          }
          case 'consolidation-breakout': {
            const y1 = yPrice(p.rangeHigh);
            const y2 = yPrice(p.rangeLow);
            return (
              <g key={pi} {...gProps}>
                <rect x={x(clampedStart)} y={y1} width={x(clampedEnd) - x(clampedStart)} height={y2 - y1}
                  fill={patternFill} stroke={patternColor} strokeWidth="0.7" strokeDasharray="3,2" />
                <text x={x(clampedStart) + 4} y={y1 - 4} fill={patternColor} fontSize={10} fontWeight="600">
                  {p.label}
                </text>
              </g>
            );
          }
          case 'bull-flag': {
            const poleS = Math.max(0, p.poleStartIndex - zStart);
            const poleE = Math.max(0, p.poleEndIndex - zStart);
            const flagS = Math.max(0, p.flagStartIndex - zStart);
            const flagE = Math.min(visCandles.length - 1, p.flagEndIndex - zStart);
            if (poleS >= visCandles.length || flagE < 0) return null;
            // Pole highlight
            const poleCandles = visCandles.slice(poleS, poleE + 1);
            const poleLow = Math.min(...poleCandles.map(c => c.low));
            const poleHigh = Math.max(...poleCandles.map(c => c.high));
            // Flag channel
            const flagCandles = visCandles.slice(flagS, flagE + 1);
            const flagHigh = Math.max(...flagCandles.map(c => c.high));
            const flagLow = Math.min(...flagCandles.map(c => c.low));
            return (
              <g key={pi} {...gProps}>
                {/* Pole shading */}
                <rect x={x(poleS)} y={yPrice(poleHigh)} width={x(poleE) - x(poleS)} height={yPrice(poleLow) - yPrice(poleHigh)}
                  fill="#4ade8015" stroke="#4ade80" strokeWidth="0.5" />
                {/* Flag channel */}
                <rect x={x(flagS)} y={yPrice(flagHigh)} width={x(flagE) - x(flagS)} height={yPrice(flagLow) - yPrice(flagHigh)}
                  fill={patternFill} stroke={patternColor} strokeWidth="0.7" strokeDasharray="3,2" />
                <text x={x(flagS) + 4} y={yPrice(flagHigh) - 4} fill={patternColor} fontSize={10} fontWeight="600">
                  {p.label}
                </text>
              </g>
            );
          }
          case 'ascending-triangle': {
            const ry = yPrice(p.resistancePrice);
            // Rising trendline from first to last swing low
            const visSwingLows = p.swingLowIndices
              .map(si => si - zStart)
              .filter(si => si >= 0 && si < visCandles.length);
            return (
              <g key={pi} {...gProps}>
                {/* Resistance line */}
                <line x1={x(clampedStart)} y1={ry} x2={x(clampedEnd)} y2={ry}
                  stroke={patternColor} strokeWidth={strokeW} strokeDasharray="4,3" />
                {/* Rising trendline through swing lows */}
                {visSwingLows.length >= 2 && (
                  <line
                    x1={x(visSwingLows[0])} y1={yPrice(visCandles[visSwingLows[0]].low)}
                    x2={x(visSwingLows[visSwingLows.length - 1])} y2={yPrice(visCandles[visSwingLows[visSwingLows.length - 1]].low)}
                    stroke={patternColor} strokeWidth={strokeW}
                  />
                )}
                {/* Triangle fill */}
                {visSwingLows.length >= 2 && (
                  <polygon
                    points={[
                      `${x(visSwingLows[0])},${yPrice(visCandles[visSwingLows[0]].low)}`,
                      `${x(visSwingLows[visSwingLows.length - 1])},${yPrice(visCandles[visSwingLows[visSwingLows.length - 1]].low)}`,
                      `${x(clampedEnd)},${ry}`,
                      `${x(clampedStart)},${ry}`,
                    ].join(' ')}
                    fill={patternFill}
                  />
                )}
                <text x={x(clampedStart) + 4} y={ry - 4} fill={patternColor} fontSize={10} fontWeight="600">
                  {p.label}
                </text>
              </g>
            );
          }
          case 'channel-breakout': {
            // Draw upper and lower trendlines using slope/intercept
            // Indices are relative to pattern window start
            const startOffset = p.startIndex - zStart;
            const upperY1 = yPrice(p.upperIntercept + p.upperSlope * Math.max(0, -startOffset));
            const upperY2 = yPrice(p.upperIntercept + p.upperSlope * (clampedEnd - startOffset));
            const lowerY1 = yPrice(p.lowerIntercept + p.lowerSlope * Math.max(0, -startOffset));
            const lowerY2 = yPrice(p.lowerIntercept + p.lowerSlope * (clampedEnd - startOffset));
            return (
              <g key={pi} {...gProps}>
                {/* Upper trendline */}
                <line x1={x(clampedStart)} y1={upperY1} x2={x(clampedEnd)} y2={upperY2}
                  stroke={patternColor} strokeWidth={strokeW} />
                {/* Lower trendline */}
                <line x1={x(clampedStart)} y1={lowerY1} x2={x(clampedEnd)} y2={lowerY2}
                  stroke={patternColor} strokeWidth={strokeW} />
                {/* Channel fill */}
                <polygon
                  points={[
                    `${x(clampedStart)},${upperY1}`,
                    `${x(clampedEnd)},${upperY2}`,
                    `${x(clampedEnd)},${lowerY2}`,
                    `${x(clampedStart)},${lowerY1}`,
                  ].join(' ')}
                  fill={patternFill}
                />
                <text x={x(clampedStart) + 4} y={Math.min(upperY1, upperY2) - 4} fill={patternColor} fontSize={10} fontWeight="600">
                  {p.label}
                </text>
              </g>
            );
          }
          default:
            return null;
        }
      })}

      {/* Y-axis labels */}
      {yTicks.map((t, i) => (
        <text
          key={i}
          x={padLeft - 5}
          y={t.y + 3}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={14}
        >
          ${fmtPrice(t.price)}
        </text>
      ))}

      {/* X-axis labels */}
      {timeLabels.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={height - padBottom + 15}
          textAnchor="middle"
          fill="#6b7280"
          fontSize={12}
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
        y={yPrice(closes[closes.length - 1]) + 5}
        fill={lineColor}
        fontSize={14}
        fontWeight="bold"
      >
        ${fmtPrice(closes[closes.length - 1])}
      </text>

      {/* Hover crosshair + tooltip */}
      {hoverIndex != null && (
        <g>
          <line x1={hx} y1={padTop} x2={hx} y2={height - padBottom} stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2,2" />
          <line x1={padLeft} y1={hy} x2={width - padRight} y2={hy} stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2,2" />
          <circle cx={hx} cy={hy} r="3.5" fill={lineColor} stroke="#111827" strokeWidth="1.5" />
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="3" fill="#111827" stroke="#4b5563" strokeWidth="0.5" />
          <text x={tipX + tipW / 2} y={tipY + 14} textAnchor="middle" fill="#e5e7eb" fontSize={14} fontWeight="600">
            ${fmtPrice(closes[hIdx])}
          </text>
          <text x={tipX + tipW / 2} y={tipY + 27} textAnchor="middle" fill="#9ca3af" fontSize={12}>
            {hoverTime}
          </text>
        </g>
      )}

      {/* Full-area hit target */}
      <rect x={0} y={0} width={width} height={height} fill="transparent" />
    </svg>
    </div>
  );
}
