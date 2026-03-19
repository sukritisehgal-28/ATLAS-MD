import { useState, useEffect, useCallback } from 'react';
import { extractHighlights } from '../services/api';

const IMPORTANCE_CONFIG = {
  critical: { color: '#dc2626', bg: 'rgba(220, 38, 38, 0.05)', label: 'CRITICAL' },
  high: { color: '#d97706', bg: 'rgba(217, 119, 6, 0.05)', label: 'HIGH' },
  moderate: { color: '#2563eb', bg: 'rgba(37, 99, 235, 0.04)', label: 'MODERATE' },
};

const TYPE_ICONS = {
  finding: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  method: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  conclusion: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  limitation: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

export default function PaperReader({ paper, onHighlightsLoaded, rankedPapers, onSelectPaper }) {
  const [highlights, setHighlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(null);

  const loadHighlights = useCallback(async () => {
    if (!paper) return;
    setLoading(true);
    try {
      const data = await extractHighlights(paper);
      setHighlights(data.highlights || []);
      if (onHighlightsLoaded) onHighlightsLoaded(data.highlights || []);
    } catch (err) {
      console.error('Failed to load highlights:', err);
      setHighlights([]);
    } finally {
      setLoading(false);
    }
  }, [paper, onHighlightsLoaded]);

  useEffect(() => {
    loadHighlights();
    return () => window.speechSynthesis?.cancel();
  }, [loadHighlights]);

  const speak = (text, index) => {
    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.onend = () => setSpeakingIndex(null);
    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  const currentIndex = rankedPapers?.findIndex((p) => p.paperId === paper?.paperId) ?? -1;
  const nextPaper = currentIndex >= 0 && currentIndex < (rankedPapers?.length || 0) - 1
    ? rankedPapers[currentIndex + 1]
    : null;

  if (!paper) {
    return (
      <div className="paper-reader empty">
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <h3>Select a Paper</h3>
          <p>Click a node in the graph or select from the ranking to start reading with AI-extracted insights.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="paper-reader">
      <div className="reader-header">
        <div className="reader-badge">
          Paper {currentIndex + 1} of {rankedPapers?.length || '?'}
        </div>
        <h3>{paper.title}</h3>
        <div className="paper-meta-row">
          <span className="meta-chip year">{paper.year}</span>
          <span className="meta-chip">{paper.citationCount || 0} citations</span>
          {paper.openAccessPdf?.url && (
            <a href={paper.openAccessPdf.url} target="_blank" rel="noopener noreferrer" className="meta-link">
              PDF Available
            </a>
          )}
          {paper.url && (
            <a href={paper.url} target="_blank" rel="noopener noreferrer" className="meta-link">
              Semantic Scholar
            </a>
          )}
        </div>
      </div>

      <div className="highlights-section">
        <div className="section-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          AI-Extracted Highlights
        </div>
        {loading ? (
          <div className="loading-highlights">
            <div className="highlight-skeleton" />
            <div className="highlight-skeleton" />
            <div className="highlight-skeleton" />
          </div>
        ) : (
          <div className="highlights-list">
            {highlights.map((h, i) => {
              const config = IMPORTANCE_CONFIG[h.importance] || IMPORTANCE_CONFIG.moderate;
              return (
                <div
                  key={i}
                  className="highlight-card"
                  style={{ '--highlight-color': config.color, '--highlight-bg': config.bg }}
                >
                  <div className="highlight-top">
                    <div className="highlight-tags">
                      <span className="tag importance">{config.label}</span>
                      <span className="tag type">
                        {TYPE_ICONS[h.type] || null}
                        {h.type}
                      </span>
                    </div>
                    <button
                      className={`speak-btn ${speakingIndex === i ? 'speaking' : ''}`}
                      onClick={() => speak(h.text, i)}
                      title={speakingIndex === i ? 'Stop' : 'Read aloud'}
                    >
                      {speakingIndex === i ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
                      )}
                    </button>
                  </div>
                  <p>{h.text}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {paper.abstract && (
        <div className="abstract-section">
          <div className="section-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
            </svg>
            Full Abstract
          </div>
          <p className="abstract-text">{paper.abstract}</p>
        </div>
      )}

      {nextPaper && (
        <button className="next-paper-btn" onClick={() => onSelectPaper(nextPaper)}>
          <span>Next Paper</span>
          <span className="next-title">{nextPaper.title.slice(0, 50)}...</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      )}
    </div>
  );
}
