'use client';

interface RadarCategory {
  label: string;
  value: number;  // 0–1 (proportion of max)
  max: number;
  actual: number;
}

interface RadarChartProps {
  categories: RadarCategory[];
  size?: number;
  className?: string;
}

export function RadarChart({ categories, size = 240, className = '' }: RadarChartProps) {
  if (categories.length < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 30;
  const angleStep = (2 * Math.PI) / categories.length;
  const levels = [0.25, 0.5, 0.75, 1.0];

  function polarToCart(angle: number, r: number) {
    // Start from top (-90°)
    const a = angle - Math.PI / 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  // Grid rings
  const rings = levels.map((level) => {
    const pts = categories.map((_, i) => {
      const p = polarToCart(i * angleStep, radius * level);
      return `${p.x},${p.y}`;
    });
    return pts.join(' ');
  });

  // Axis lines
  const axes = categories.map((_, i) => {
    const p = polarToCart(i * angleStep, radius);
    return { x1: cx, y1: cy, x2: p.x, y2: p.y };
  });

  // Data polygon
  const dataPts = categories.map((cat, i) => {
    const p = polarToCart(i * angleStep, radius * Math.min(cat.value, 1));
    return `${p.x},${p.y}`;
  });

  // Labels
  const labels = categories.map((cat, i) => {
    const p = polarToCart(i * angleStep, radius + 18);
    return { ...p, label: cat.label, actual: cat.actual, max: cat.max };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
    >
      {/* Grid rings */}
      {rings.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill="none"
          stroke="#374151"
          strokeWidth="0.5"
        />
      ))}

      {/* Axis lines */}
      {axes.map((a, i) => (
        <line
          key={i}
          x1={a.x1}
          y1={a.y1}
          x2={a.x2}
          y2={a.y2}
          stroke="#374151"
          strokeWidth="0.5"
        />
      ))}

      {/* Data fill */}
      <polygon
        points={dataPts.join(' ')}
        fill="rgba(96, 165, 250, 0.15)"
        stroke="#60a5fa"
        strokeWidth="1.5"
      />

      {/* Data points */}
      {categories.map((cat, i) => {
        const p = polarToCart(i * angleStep, radius * Math.min(cat.value, 1));
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3"
            fill={cat.value >= 0.7 ? '#4ade80' : cat.value >= 0.3 ? '#60a5fa' : '#6b7280'}
          />
        );
      })}

      {/* Labels */}
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-gray-400"
          fontSize="9"
        >
          {l.label}
        </text>
      ))}
    </svg>
  );
}
