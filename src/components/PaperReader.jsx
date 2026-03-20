import { useState, useEffect, useRef } from 'react';

const importanceColor = { critical: '#f87171', high: '#f59e0b', moderate: '#2563eb' };
const importanceBg = { critical: '#1c0a0a', high: '#1c1004', moderate: '#0f1e35' };
const typeIcon = { finding: '◈', method: '⊕', conclusion: '✓', limitation: '⚠' };
const typeLabel = { finding: 'Key Finding', method: 'Methodology', conclusion: 'Conclusion', limitation: 'Limitation' };

function buildAnnotatedSections(abstract, highlights) {
  if (!abstract || !highlights?.length) {
    return [{ text: abstract || 'No abstract available.', highlight: null }];
  }

  const sections = [];
  let remaining = abstract;

  for (const hl of highlights) {
    if (!hl.passage) continue;
    const idx = remaining.indexOf(hl.passage);
    if (idx === -1) continue;
    if (idx > 0) sections.push({ text: remaining.slice(0, idx), highlight: null });
    sections.push({ text: hl.passage, highlight: hl });
    remaining = remaining.slice(idx + hl.passage.length);
  }

  if (remaining.trim()) sections.push({ text: remaining, highlight: null });

  // If no passages matched, assign highlights to sentences
  if (sections.every((s) => !s.highlight) && highlights.length) {
    const sentences = abstract.split(/(?<=[.!?])\s+/).filter(Boolean);
    const merged = [];
    let hlIdx = 0;
    for (let i = 0; i < sentences.length; i++) {
      if (hlIdx < highlights.length && i % Math.ceil(sentences.length / highlights.length) === 0) {
        merged.push({ text: sentences[i], highlight: highlights[hlIdx] });
        hlIdx++;
      } else {
        merged.push({ text: sentences[i], highlight: null });
      }
    }
    return merged;
  }

  return sections;
}

export default function PaperReader({ paper, highlights, highlightsLoading, rankedPapers, onSelectPaper }) {
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [isSpeakingAll, setIsSpeakingAll] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const saveMenuRef = useRef(null);

  // Close save menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target)) {
        setShowSaveMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cancel speech on unmount or paper change
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      setIsSpeakingAll(false);
    };
  }, [paper?.paperId]);

  const speak = (text, index) => {
    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }
    window.speechSynthesis.cancel();
    setIsSpeakingAll(false);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.onend = () => setSpeakingIndex(null);
    setSpeakingIndex(index);
    window.speechSynthesis.speak(u);
  };

  const speakAll = () => {
    window.speechSynthesis.cancel();
    setSpeakingIndex(null);

    // Build text: abstract + highlights
    let textToSpeak = '';
    if (paper?.abstract) {
      textToSpeak = paper.abstract;
    } else if (highlights?.length) {
      textToSpeak = highlights.map((h) => h.text).join('. ');
    } else {
      textToSpeak = paper?.title || 'No content available';
    }

    const u = new SpeechSynthesisUtterance(textToSpeak);
    u.rate = 0.92;
    u.onend = () => setIsSpeakingAll(false);
    setIsSpeakingAll(true);
    window.speechSynthesis.speak(u);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setSpeakingIndex(null);
    setIsSpeakingAll(false);
  };

  const savePaperAsText = () => {
    const lines = [
      paper.title,
      '',
      `Authors: ${paper.authors?.map((a) => a.name).join(', ') || 'Unknown'}`,
      `Year: ${paper.year || 'Unknown'}`,
      `Citations: ${paper.citationCount || 0}`,
      paper.url ? `URL: ${paper.url}` : '',
      paper.openAccessPdf?.url ? `PDF: ${paper.openAccessPdf.url}` : '',
      '',
      '--- ABSTRACT ---',
      paper.abstract || 'No abstract available.',
      '',
    ];

    if (highlights?.length) {
      lines.push('--- KEY HIGHLIGHTS ---');
      highlights.forEach((h, i) => {
        lines.push(`${i + 1}. [${(h.importance || '').toUpperCase()}] ${h.text}`);
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${paper.title?.slice(0, 50).replace(/[^a-zA-Z0-9 ]/g, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setShowSaveMenu(false);
  };

  const copyPaperToClipboard = async () => {
    const lines = [
      paper.title,
      `Authors: ${paper.authors?.map((a) => a.name).join(', ') || 'Unknown'}`,
      `Year: ${paper.year}, Citations: ${paper.citationCount || 0}`,
      paper.url || '',
      '',
      paper.abstract || 'No abstract.',
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setShowSaveMenu(false);
    } catch {
      // fallback
      savePaperAsText();
    }
  };

  if (!paper) {
    return (
      <div className="paper-reader empty">
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <h3>Select a Paper</h3>
          <p>Click a node in the graph or select from the ranking to start reading.</p>
        </div>
      </div>
    );
  }

  const currentIndex = rankedPapers?.findIndex((p) => p.paperId === paper?.paperId) ?? -1;
  const nextPaper = currentIndex >= 0 && currentIndex < (rankedPapers?.length || 0) - 1
    ? rankedPapers[currentIndex + 1]
    : null;
  const prevPaper = currentIndex > 0 ? rankedPapers[currentIndex - 1] : null;

  const sections = buildAnnotatedSections(paper.abstract, highlights);

  return (
    <div className="paper-reader">
      <div className="reader-content">
        {/* Header */}
        <div className="reader-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="reader-badge">
              PAPER {currentIndex + 1} OF {rankedPapers?.length || '?'}
            </div>
            <div className="reader-nav" style={{ display: 'flex', gap: 6 }}>
              {prevPaper && (
                <button className="btn btn-sm" onClick={() => onSelectPaper(prevPaper)}>
                  &larr; Prev
                </button>
              )}
              {nextPaper && (
                <button className="btn btn-sm" onClick={() => onSelectPaper(nextPaper)}>
                  Next &rarr;
                </button>
              )}
            </div>
          </div>

          <h3>{paper.title}</h3>
          <hr />

          <div className="reader-meta-row">
            {paper.authors?.slice(0, 3).map((a) => a.name).join(', ')}
            {paper.authors?.length > 3 ? ' et al.' : ''}
            <span> · {paper.year}</span>
            <span> · {paper.citationCount || 0} citations</span>
          </div>

          <div className="reader-actions">
            <button className="btn btn-sm" onClick={isSpeakingAll ? stopSpeaking : speakAll}>
              {isSpeakingAll ? '■ Stop' : '▶ Listen'}
            </button>
            {paper.openAccessPdf?.url && (
              <a href={paper.openAccessPdf.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                ↗ PDF
              </a>
            )}
            {paper.url && (
              <a href={paper.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                ↗ Source
              </a>
            )}
            {/* Save dropdown */}
            <div style={{ position: 'relative' }} ref={saveMenuRef}>
              <button className="btn btn-sm btn-green" onClick={() => setShowSaveMenu(!showSaveMenu)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                Save
              </button>
              {showSaveMenu && (
                <div className="save-dropdown">
                  <button className="save-dropdown-item" onClick={savePaperAsText}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Download as .txt
                  </button>
                  <button className="save-dropdown-item" onClick={copyPaperToClipboard}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Copy to clipboard
                  </button>
                  {paper.openAccessPdf?.url && (
                    <a className="save-dropdown-item" href={paper.openAccessPdf.url} download target="_blank" rel="noopener noreferrer" onClick={() => setShowSaveMenu(false)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      Download PDF
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Annotated content */}
        {highlightsLoading ? (
          <div className="highlights-loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="highlight-skeleton" />
            ))}
            <div className="highlights-loading-text">Analyzing this paper...</div>
          </div>
        ) : (
          <div>
            {sections.map((section, i) => (
              <div key={i} style={{ marginBottom: 20 }}>
                {/* Text passage */}
                <div
                  className={`annotation-passage ${section.highlight ? 'highlighted' : ''}`}
                  style={{
                    borderLeftColor: section.highlight ? importanceColor[section.highlight.importance] : 'transparent',
                    background: section.highlight ? `${importanceColor[section.highlight.importance]}08` : 'transparent',
                  }}
                >
                  {section.text}
                </div>

                {/* Annotation drop */}
                {section.highlight && (
                  <div className="annotation-drop fadein">
                    <div
                      className="annotation-connector"
                      style={{ background: importanceColor[section.highlight.importance] }}
                    />
                    <div
                      className="annotation-card"
                      style={{
                        border: `1px solid ${importanceColor[section.highlight.importance]}35`,
                        borderLeft: `3px solid ${importanceColor[section.highlight.importance]}`,
                        background: importanceBg[section.highlight.importance],
                      }}
                    >
                      <div className="annotation-badge-row">
                        <span
                          className="annotation-importance"
                          style={{
                            background: `${importanceColor[section.highlight.importance]}20`,
                            border: `1px solid ${importanceColor[section.highlight.importance]}50`,
                            color: importanceColor[section.highlight.importance],
                          }}
                        >
                          {typeIcon[section.highlight.type]} {section.highlight.importance?.toUpperCase()}
                        </span>
                        <span className="annotation-type">
                          {typeLabel[section.highlight.type]}
                        </span>
                        <button
                          className="annotation-listen"
                          onClick={() => speak(section.highlight.text, i)}
                        >
                          {speakingIndex === i ? '■ stop' : '▶ listen'}
                        </button>
                      </div>
                      <div className="annotation-text">{section.highlight.text}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* If no abstract at all, show a notice */}
            {!paper.abstract && (
              <div className="no-abstract-notice">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <strong>No abstract available</strong>
                  <p>This paper's abstract was not indexed by Semantic Scholar.
                    {paper.url && <> Visit the <a href={paper.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>source</a> for full text.</>}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Next paper button */}
        {nextPaper && (
          <button className="next-paper-btn" onClick={() => onSelectPaper(nextPaper)}>
            <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: 1, whiteSpace: 'nowrap' }}>NEXT PAPER</span>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nextPaper.title?.slice(0, 50)}...
            </span>
            <span style={{ color: 'var(--text-muted)' }}>&rsaquo;</span>
          </button>
        )}
      </div>
    </div>
  );
}
