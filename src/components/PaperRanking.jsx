import { useState, useEffect } from 'react';
import PaperDNA from './PaperDNA';

const EVIDENCE_COLORS = {
  1: '#22c55e', // green - systematic review
  2: '#3b82f6', // blue - RCT
  3: '#8b5cf6', // purple - cohort
  4: '#f59e0b', // amber - case-control
  5: '#ef4444', // red - case series
  6: '#94a3b8', // gray - expert opinion
};

const EVIDENCE_LABELS = {
  1: 'Systematic Review',
  2: 'RCT',
  3: 'Cohort',
  4: 'Case-Control',
  5: 'Case Series',
  6: 'Expert Opinion',
};

export default function PaperRanking({ papers, summaries, evidence, onSelectPaper, selectedPaperId, bookmarks, onToggleBookmark, isBookmarked }) {
  const [rankedPapers, setRankedPapers] = useState(papers);

  useEffect(() => {
    setRankedPapers(papers);
  }, [papers]);

  const movePaper = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= rankedPapers.length) return;
    const updated = [...rankedPapers];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setRankedPapers(updated);
  };

  return (
    <div className="paper-ranking">
      <div className="section-header">
        <div className="section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <h3>Paper Rankings</h3>
          <span className="paper-count">{rankedPapers.length} papers</span>
        </div>
        <p className="section-subtitle">Reorder by clinical relevance. Click to read.</p>
      </div>
      <div className="ranking-list">
        {rankedPapers.map((paper, i) => {
          const ev = evidence?.[paper.paperId];
          const bookmarked = isBookmarked?.(paper.paperId);
          return (
            <div
              key={paper.paperId}
              className={`ranking-card ${paper.paperId === selectedPaperId ? 'selected' : ''}`}
              onClick={() => onSelectPaper(paper)}
            >
              <div className="ranking-controls">
                <button
                  className="rank-btn"
                  onClick={(e) => { e.stopPropagation(); movePaper(i, -1); }}
                  disabled={i === 0}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>
                </button>
                <span className="rank-number">{i + 1}</span>
                <button
                  className="rank-btn"
                  onClick={(e) => { e.stopPropagation(); movePaper(i, 1); }}
                  disabled={i === rankedPapers.length - 1}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
              </div>
              <div className="ranking-content">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <h4 style={{ flex: 1, margin: 0 }}>{paper.title}</h4>
                  <button
                    className="bookmark-btn"
                    onClick={(e) => { e.stopPropagation(); onToggleBookmark?.(paper); }}
                    title={bookmarked ? 'Remove bookmark' : 'Bookmark paper'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: bookmarked ? '#f59e0b' : 'var(--text-muted)', padding: '2px', flexShrink: 0, transition: 'color 0.2s' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                </div>
                <div className="paper-meta">
                  <PaperDNA paper={paper} evidence={ev} size="small" />
                  <span className="meta-chip year">{paper.year || 'N/A'}</span>
                  <span className="meta-chip">{paper.citationCount || 0} cited</span>
                  {ev && (
                    <span
                      className="meta-chip evidence-chip"
                      style={{ borderColor: EVIDENCE_COLORS[ev.level] || '#94a3b8', color: EVIDENCE_COLORS[ev.level] || '#94a3b8' }}
                      title={ev.reason || ''}
                    >
                      <span className="evidence-dots">
                        {[1, 2, 3, 4, 5, 6].map((lvl) => (
                          <span
                            key={lvl}
                            className="evidence-dot"
                            style={{ background: lvl <= (7 - ev.level) ? (EVIDENCE_COLORS[ev.level] || '#94a3b8') : 'rgba(255,255,255,0.1)' }}
                          />
                        ))}
                      </span>
                      {ev.type || EVIDENCE_LABELS[ev.level] || 'Unknown'}
                    </span>
                  )}
                  <span className="meta-authors">
                    {paper.authors?.slice(0, 2).map((a) => a.name).join(', ')}
                    {paper.authors?.length > 2 ? ' et al.' : ''}
                  </span>
                </div>
                {summaries[paper.paperId] && (
                  <p className="paper-summary">{summaries[paper.paperId]}</p>
                )}
              </div>
              <div className="card-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
