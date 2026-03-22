import { useMemo } from 'react';

// Generate a unique visual fingerprint for a paper based on its characteristics
// Renders as a small SVG with colored segments representing different paper attributes

const LEVEL_COLORS = {
  1: '#10b981', // Meta-analysis — green (strongest)
  2: '#2563eb', // RCT — blue
  3: '#8b5cf6', // Cohort — violet
  4: '#f59e0b', // Case-control — amber
  5: '#f97316', // Case series — orange
  6: '#94a3b8', // Expert opinion — gray
};

const LEVEL_LABELS = {
  1: 'Meta-analysis',
  2: 'RCT',
  3: 'Cohort',
  4: 'Case-control',
  5: 'Case series',
  6: 'Expert opinion',
};

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export default function PaperDNA({ paper, evidence, size = 'small' }) {
  const dna = useMemo(() => {
    if (!paper) return null;

    const level = evidence?.level || 5;
    const year = paper.year || 2020;
    const citations = paper.citationCount || 0;
    const titleHash = hashString(paper.title || '');

    // Normalize metrics to 0-1 range
    const recency = Math.min(1, Math.max(0, (year - 2000) / 26)); // 2000-2026
    const impact = Math.min(1, citations / 500); // 0-500+ citations
    const evidenceStrength = 1 - ((level - 1) / 5); // Level 1 = 1.0, Level 6 = 0
    const abstractLength = paper.abstract ? Math.min(1, paper.abstract.length / 2000) : 0.3;
    const authorCount = Math.min(1, (paper.authors?.length || 1) / 15);

    // Generate DNA segments — each is a bar with width proportional to the metric
    const segments = [
      { metric: evidenceStrength, color: LEVEL_COLORS[level] || '#94a3b8', label: 'Evidence' },
      { metric: impact, color: '#2563eb', label: 'Impact' },
      { metric: recency, color: '#10b981', label: 'Recency' },
      { metric: abstractLength, color: '#8b5cf6', label: 'Depth' },
      { metric: authorCount, color: '#f59e0b', label: 'Team' },
    ];

    // Unique pattern seed from title hash
    const patternSeed = titleHash % 360;

    return { segments, level, patternSeed, evidenceStrength, impact, recency };
  }, [paper, evidence]);

  if (!dna) return null;

  const isLarge = size === 'large';
  const w = isLarge ? 120 : 44;
  const h = isLarge ? 44 : 20;

  if (isLarge) {
    return (
      <div className="paper-dna paper-dna-large">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {dna.segments.map((seg, i) => {
            const barW = seg.metric * 18 + 3;
            const y = i * 8 + 2;
            return (
              <g key={i}>
                <rect
                  x={2}
                  y={y}
                  width={barW}
                  height={5}
                  rx={2.5}
                  fill={seg.color}
                  opacity={0.7 + seg.metric * 0.3}
                />
                <rect
                  x={barW + 4}
                  y={y}
                  width={21 - barW}
                  height={5}
                  rx={2.5}
                  fill={seg.color}
                  opacity={0.15}
                />
              </g>
            );
          })}
          {/* Unique pattern overlay */}
          <circle
            cx={w - 20}
            cy={h / 2}
            r={14}
            fill="none"
            stroke={LEVEL_COLORS[dna.level]}
            strokeWidth={1.5}
            opacity={0.4}
            strokeDasharray={`${dna.patternSeed % 8 + 2} ${dna.patternSeed % 4 + 2}`}
          />
          <circle
            cx={w - 20}
            cy={h / 2}
            r={8}
            fill={LEVEL_COLORS[dna.level]}
            opacity={0.15}
          />
          <text
            x={w - 20}
            y={h / 2 + 3.5}
            textAnchor="middle"
            fill={LEVEL_COLORS[dna.level]}
            fontSize="8"
            fontWeight="700"
            fontFamily="var(--font-mono)"
          >
            L{dna.level}
          </text>
        </svg>
        <div className="paper-dna-labels">
          {dna.segments.map((seg, i) => (
            <div key={i} className="paper-dna-label" style={{ color: seg.color }}>
              <span className="paper-dna-dot" style={{ background: seg.color }} />
              {seg.label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Small inline version — compact horizontal bars
  return (
    <div className="paper-dna paper-dna-small" title={`Evidence: L${dna.level} ${LEVEL_LABELS[dna.level] || ''}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {dna.segments.map((seg, i) => {
          const barW = seg.metric * 6 + 2;
          const y = i * 4;
          return (
            <rect
              key={i}
              x={0}
              y={y}
              width={barW}
              height={3}
              rx={1.5}
              fill={seg.color}
              opacity={0.6 + seg.metric * 0.4}
            />
          );
        })}
        {/* Level badge */}
        <rect
          x={12}
          y={2}
          width={16}
          height={16}
          rx={4}
          fill={LEVEL_COLORS[dna.level]}
          opacity={0.15}
        />
        <text
          x={20}
          y={13}
          textAnchor="middle"
          fill={LEVEL_COLORS[dna.level]}
          fontSize="8"
          fontWeight="700"
          fontFamily="var(--font-mono)"
        >
          L{dna.level}
        </text>
        {/* Unique pattern — small arc */}
        <path
          d={`M 32 ${10 + (dna.patternSeed % 6)} a ${4 + dna.patternSeed % 3} ${4 + dna.patternSeed % 3} 0 0 1 ${8 + dna.patternSeed % 4} 0`}
          fill="none"
          stroke={LEVEL_COLORS[dna.level]}
          strokeWidth={1}
          opacity={0.4}
        />
      </svg>
    </div>
  );
}
