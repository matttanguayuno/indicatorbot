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
  onPatternClick?: (index: number, clickPos?: { x: number; y: number }) => void;
  onBackgroundClick?: () => void;
  chartMode?: 'line' | 'candle';
  width?: number;
  height?: number;
  className?: string;
}

export function PriceChart({
  candles,
  patterns,
  highlightPatternIndex,
  onPatternClick,
  onBackgroundClick,
  chartMode = 'line',
  width: defaultW = 900,
  height: defaultH = 350,
  className = '',
}: PriceChartProps) {
  if (candles.length < 2) return null;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverInVolume, setHoverInVolume] = useState(false);
  const [zoom, setZoom] = useState<[number, number]>([0, 1]);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startZoom: [number, number]; hasDragged: boolean } | null>(null);
  const patternClickedRef = useRef(false);
  const dragOccurredRef = useRef(false);
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
  const volHeight = 56;

  const chartW = width - padLeft - padRight;
  const priceH = height - padTop - padBottom - volHeight;
  const volTop = padTop + priceH; // y where volume section starts

  const closes = visCandles.map((c) => c.close);
  const highs = visCandles.map((c) => c.high);
  const lows = visCandles.map((c) => c.low);
  const volumes = visCandles.map((c) => c.volume);

  let priceMin = Math.min(...lows);
  let priceMax = Math.max(...highs);

  // Expand price range to include visible pattern overlay extents + label room
  if (patterns) {
    for (const p of patterns) {
      const vStart = p.startIndex - zStart;
      const vEnd = p.endIndex - zStart;
      if (vEnd < 0 || vStart >= visCandles.length) continue;
      // Compute the highest/lowest price this pattern's overlay reaches
      let pHigh = priceMax;
      let pLow = priceMin;
      switch (p.type) {
        case 'volume-breakout':
          pHigh = p.resistancePrice;
          break;
        case 'consolidation-breakout':
          pHigh = p.rangeHigh;
          pLow = p.rangeLow;
          break;
        case 'bull-flag': {
          const pS = Math.max(0, p.poleStartIndex - zStart);
          const pE = Math.max(0, p.poleEndIndex - zStart);
          const fS = Math.max(0, p.flagStartIndex - zStart);
          const fE = Math.min(visCandles.length - 1, p.flagEndIndex - zStart);
          if (pS < visCandles.length && fE >= 0) {
            const poleSlice = visCandles.slice(pS, pE + 1);
            const flagSlice = visCandles.slice(fS, fE + 1);
            if (poleSlice.length > 0) pHigh = Math.max(pHigh, Math.max(...poleSlice.map(c => c.high)));
            if (flagSlice.length > 0) {
              pHigh = Math.max(pHigh, Math.max(...flagSlice.map(c => c.high)));
              pLow = Math.min(pLow, Math.min(...flagSlice.map(c => c.low)));
            }
          }
          break;
        }
        case 'ascending-triangle':
          pHigh = p.resistancePrice;
          break;
        case 'double-bottom':
          pHigh = p.necklinePrice;
          pLow = Math.min(p.firstBottomPrice, p.secondBottomPrice);
          break;
        case 'inside-bar-breakout':
          pHigh = p.motherBarHigh;
          pLow = p.motherBarLow;
          break;
        case 'vwap-reclaim':
          pHigh = p.vwapPrice;
          break;
        default:
          break;
      }
      priceMax = Math.max(priceMax, pHigh);
      priceMin = Math.min(priceMin, pLow);
    }
    // Add ~5% headroom above for labels
    const rawRange = priceMax - priceMin || 1;
    priceMax += rawRange * 0.05;
  }

  const priceRange = priceMax - priceMin || 1;
  const volMax = Math.max(...volumes) || 1;

  const isPositive = closes[closes.length - 1] >= visCandles[0].open;
  const lineColor = isPositive ? '#60a5fa' : '#f87171';
  const fillColor = isPositive ? '#60a5fa18' : '#f8717118';

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
      dragRef.current = { startX: e.clientX, startZoom: [...zoom] as [number, number], hasDragged: false };
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
        // Only start dragging after a threshold to allow clicks
        if (!dragRef.current.hasDragged && Math.abs(dx) < 5) return;
        if (!dragRef.current.hasDragged) {
          dragRef.current.hasDragged = true;
          svgRef.current?.setPointerCapture(e.pointerId);
        }
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
      const screenY = e.clientY - rect.top;
      const fraction = (screenX / rect.width - padLeft / width) / (chartW / width);
      const idx = Math.round(fraction * (visCandles.length - 1));
      setHoverIndex(Math.max(0, Math.min(visCandles.length - 1, idx)));
      // Detect if pointer is in the volume area
      const svgY = (screenY / rect.height) * height;
      setHoverInVolume(svgY >= volTop);
    },
    [width, height, padLeft, padRight, chartW, visCandles.length, zoom, volTop],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragRef.current) {
        dragOccurredRef.current = dragRef.current.hasDragged;
        if (dragRef.current.hasDragged) svgRef.current?.releasePointerCapture(e.pointerId);
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
  const hy = hoverInVolume ? yVol(volumes[hIdx]) : yPrice(closes[hIdx]);
  const tipW = chartMode === 'candle' ? 140 : 110;
  const tipH = chartMode === 'candle' ? 58 : 34;
  let tipX = hx - tipW / 2;
  if (tipX < padLeft) tipX = padLeft;
  if (tipX + tipW > width - padRight) tipX = width - padRight - tipW;
  let tipY = hy - tipH - 8;
  if (tipY < 2) tipY = hy + 8;

  // Format volume for tooltip
  function fmtVol(v: number) {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
    return v.toLocaleString();
  }

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
      onClick={() => { if (!patternClickedRef.current && !dragOccurredRef.current && onBackgroundClick) onBackgroundClick(); patternClickedRef.current = false; dragOccurredRef.current = false; }}
      onDoubleClick={() => setZoom([0, 1])}
      style={{ touchAction: 'none', userSelect: 'none', width: '100%', height: '100%', cursor: isZoomed ? 'grab' : 'crosshair' }}
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
      {chartMode === 'line' && <path d={areaPath} fill={fillColor} />}

      {/* Price line */}
      {chartMode === 'line' && (
        <polyline
          points={linePoints}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Candlesticks */}
      {chartMode === 'candle' && visCandles.map((c, i) => {
        const isUp = c.close >= c.open;
        const bodyTop = yPrice(isUp ? c.close : c.open);
        const bodyBot = yPrice(isUp ? c.open : c.close);
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const candleW = Math.max(1, Math.min(barW * 0.8, chartW / visCandles.length * 0.7));
        return (
          <g key={`candle-${i}`}>
            {/* Wick */}
            <line
              x1={x(i)} y1={yPrice(c.high)} x2={x(i)} y2={yPrice(c.low)}
              stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth={1}
            />
            {/* Body */}
            <rect
              x={x(i) - candleW / 2} y={bodyTop}
              width={candleW} height={bodyH}
              fill={isUp ? '#22c55e' : '#ef4444'}
              stroke={isUp ? '#16a34a' : '#dc2626'}
              strokeWidth={0.5}
            />
          </g>
        );
      })}

      {/* Volume bars */}
      {visCandles.map((c, i) => (
        <rect
          key={i}
          x={x(i) - barW / 2}
          y={yVol(c.volume)}
          width={barW}
          height={height - padBottom - yVol(c.volume)}
          fill={c.close >= c.open ? '#60a5fa30' : '#f8717130'}
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
        const conv = Math.round(p.conviction * 100);
        const patternColor = dimmed ? '#9ca3af' : conv >= 70 ? '#4ade80' : conv >= 45 ? '#facc15' : '#fb923c';
        const patternFill = dimmed ? '#9ca3af08' : isHighlighted
          ? (conv >= 70 ? '#4ade8030' : conv >= 45 ? '#facc1530' : '#fb923c30')
          : (conv >= 70 ? '#4ade8015' : conv >= 45 ? '#facc1515' : '#fb923c15');
        const strokeW = isHighlighted ? 2.5 : 1.5;
        const opacity = dimmed ? 0.3 : 1;
        const gProps = {
          opacity,
          style: { cursor: onPatternClick ? 'pointer' : undefined } as React.CSSProperties,
          onClick: onPatternClick ? (e: React.MouseEvent) => { e.stopPropagation(); patternClickedRef.current = true; const rect = svgRef.current?.getBoundingClientRect(); onPatternClick(pi, rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined); } : undefined,
        };

        switch (p.type) {
          case 'volume-breakout': {
            const ry = yPrice(p.resistancePrice);
            return (
              <g key={pi} {...gProps}>
                <line x1={x(clampedStart)} y1={ry} x2={x(clampedEnd)} y2={ry}
                  stroke={patternColor} strokeWidth={strokeW} strokeDasharray="4,3" />
                <text x={x(clampedEnd) + 4} y={ry - 6} fill={patternColor} fontSize={13} fontWeight="700">
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
                <text x={x(clampedStart) + 4} y={y1 - 6} fill={patternColor} fontSize={13} fontWeight="700">
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
                <text x={x(flagS) + 4} y={yPrice(flagHigh) - 6} fill={patternColor} fontSize={13} fontWeight="700">
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
                <text x={x(clampedStart) + 4} y={ry - 6} fill={patternColor} fontSize={13} fontWeight="700">
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
                <text x={x(clampedStart) + 4} y={Math.min(upperY1, upperY2) - 6} fill={patternColor} fontSize={13} fontWeight="700">
                  {p.label}
                </text>
              </g>
            );
          }
          case 'double-bottom': {
            const y1 = yPrice(p.firstBottomPrice);
            const y2 = yPrice(p.secondBottomPrice);
            const ny = yPrice(p.necklinePrice);
            const i1 = Math.max(0, p.firstBottomIndex - zStart);
            const i2 = Math.max(0, Math.min(visCandles.length - 1, p.secondBottomIndex - zStart));
            return (
              <g key={pi} {...gProps}>
                {/* Bottom markers */}
                <circle cx={x(i1)} cy={y1} r={4} fill={patternColor} opacity={0.7} />
                <circle cx={x(i2)} cy={y2} r={4} fill={patternColor} opacity={0.7} />
                {/* Neckline */}
                <line x1={x(clampedStart)} y1={ny} x2={x(clampedEnd)} y2={ny}
                  stroke={patternColor} strokeWidth={strokeW} strokeDasharray="4,3" />
                {/* W-shape connecting line */}
                <polyline
                  points={`${x(i1)},${y1} ${x(Math.round((i1 + i2) / 2))},${ny} ${x(i2)},${y2}`}
                  fill="none" stroke={patternColor} strokeWidth={strokeW} opacity={0.5} />
                <text x={x(clampedStart) + 4} y={ny - 6} fill={patternColor} fontSize={13} fontWeight="700">
                  {p.label}
                </text>
              </g>
            );
          }
          case 'inside-bar-breakout': {
            const mi = Math.max(0, p.motherBarIndex - zStart);
            const mh = yPrice(p.motherBarHigh);
            const ml = yPrice(p.motherBarLow);
            return (
              <g key={pi} {...gProps}>
                {/* Mother bar range */}
                <rect x={x(mi) - barW} y={mh} width={x(clampedEnd) - x(mi) + barW * 2}
                  height={ml - mh}
                  fill={patternFill} stroke={patternColor} strokeWidth={strokeW} strokeDasharray="3,2" />
                {/* Breakout level */}
                <line x1={x(mi)} y1={mh} x2={x(clampedEnd)} y2={mh}
                  stroke={patternColor} strokeWidth={strokeW} />
                <text x={x(mi) + 4} y={mh - 6} fill={patternColor} fontSize={13} fontWeight="700">
                  {p.label}
                </text>
              </g>
            );
          }
          case 'vwap-reclaim': {
            const vy = yPrice(p.vwapPrice);
            return (
              <g key={pi} {...gProps}>
                {/* VWAP line */}
                <line x1={x(clampedStart)} y1={vy} x2={x(clampedEnd)} y2={vy}
                  stroke={patternColor} strokeWidth={strokeW} strokeDasharray="6,3" />
                {/* Label */}
                <text x={x(clampedEnd) + 4} y={vy - 6} fill={patternColor} fontSize={13} fontWeight="700">
                  {p.label}
                </text>
                {/* Arrow up at reclaim point */}
                <polygon
                  points={`${x(clampedEnd)},${vy - 10} ${x(clampedEnd) - 5},${vy - 2} ${x(clampedEnd) + 5},${vy - 2}`}
                  fill={patternColor} />
              </g>
            );
          }
          case 'symmetrical-triangle': {
            const startOffset = p.startIndex - zStart;
            const upperY1 = yPrice(p.upperIntercept + p.upperSlope * Math.max(0, -startOffset));
            const upperY2 = yPrice(p.upperIntercept + p.upperSlope * (clampedEnd - startOffset));
            const lowerY1 = yPrice(p.lowerIntercept + p.lowerSlope * Math.max(0, -startOffset));
            const lowerY2 = yPrice(p.lowerIntercept + p.lowerSlope * (clampedEnd - startOffset));
            return (
              <g key={pi} {...gProps}>
                <line x1={x(clampedStart)} y1={upperY1} x2={x(clampedEnd)} y2={upperY2}
                  stroke={patternColor} strokeWidth={strokeW} />
                <line x1={x(clampedStart)} y1={lowerY1} x2={x(clampedEnd)} y2={lowerY2}
                  stroke={patternColor} strokeWidth={strokeW} />
                <polygon
                  points={[
                    `${x(clampedStart)},${upperY1}`,
                    `${x(clampedEnd)},${upperY2}`,
                    `${x(clampedEnd)},${lowerY2}`,
                    `${x(clampedStart)},${lowerY1}`,
                  ].join(' ')}
                  fill={patternFill} />
                <text x={x(clampedStart) + 4} y={Math.min(upperY1, upperY2) - 6} fill={patternColor} fontSize={13} fontWeight="700">
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
        fill={chartMode === 'candle' ? (isPositive ? '#22c55e' : '#ef4444') : lineColor}
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
          {!hoverInVolume && <line x1={padLeft} y1={hy} x2={width - padRight} y2={hy} stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2,2" />}
          <circle cx={hx} cy={hy} r="3.5" fill={hoverInVolume ? '#60a5fa' : lineColor} stroke="#111827" strokeWidth="1.5" />
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="3" fill="#111827" stroke="#4b5563" strokeWidth="0.5" />
          {chartMode === 'candle' && !hoverInVolume ? (
            <>
              <text x={tipX + tipW / 2} y={tipY + 13} textAnchor="middle" fill="#9ca3af" fontSize={11}>
                {hoverTime}
              </text>
              <text x={tipX + 6} y={tipY + 27} fill="#e5e7eb" fontSize={11}>
                O {fmtPrice(visCandles[hIdx].open)}  H {fmtPrice(visCandles[hIdx].high)}
              </text>
              <text x={tipX + 6} y={tipY + 41} fill="#e5e7eb" fontSize={11}>
                L {fmtPrice(visCandles[hIdx].low)}  C {fmtPrice(visCandles[hIdx].close)}
              </text>
              <text x={tipX + 6} y={tipY + 53} fill="#9ca3af" fontSize={10}>
                Vol: {fmtVol(volumes[hIdx])}
              </text>
            </>
          ) : (
            <>
              <text x={tipX + tipW / 2} y={tipY + 14} textAnchor="middle" fill="#e5e7eb" fontSize={14} fontWeight="600">
                {hoverInVolume ? `Vol: ${fmtVol(volumes[hIdx])}` : `$${fmtPrice(closes[hIdx])}`}
              </text>
              <text x={tipX + tipW / 2} y={tipY + 27} textAnchor="middle" fill="#9ca3af" fontSize={12}>
                {hoverTime}
              </text>
            </>
          )}
        </g>
      )}

      {/* Full-area hit target (pointer-events none so pattern overlays are clickable) */}
      <rect x={0} y={0} width={width} height={height} fill="transparent" pointerEvents="none" />
    </svg>
    </div>
  );
}
