import { useState } from 'react';

export default function PaperRanking({ papers, summaries, onSelectPaper, selectedPaperId }) {
  const [rankedPapers, setRankedPapers] = useState(papers);

  if (papers.length !== rankedPapers.length) {
    setRankedPapers(papers);
  }

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
        {rankedPapers.map((paper, i) => (
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
              <h4>{paper.title}</h4>
              <div className="paper-meta">
                <span className="meta-chip year">{paper.year || 'N/A'}</span>
                <span className="meta-chip">{paper.citationCount || 0} cited</span>
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
        ))}
      </div>
    </div>
  );
}
