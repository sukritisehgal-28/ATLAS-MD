import { useState, useCallback } from 'react';
import ResearchGraph from './components/ResearchGraph';
import PaperRanking from './components/PaperRanking';
import PaperReader from './components/PaperReader';
import AgentChat from './components/AgentChat';
import DoctorChat from './components/DoctorChat';
import PatternBanner from './components/PatternBanner';
import { useTopicTracker } from './hooks/useTopicTracker';
import {
  extractConcepts,
  searchPapers,
  analyzeRelationships,
  summarizePapers,
  extractHighlights,
} from './services/api';
import './App.css';

function createTab(id, query) {
  return {
    id,
    query,
    status: 'searching',
    concepts: [],
    papers: [],
    relationships: [],
    summaries: {},
    highlights: {},
    selectedPaper: null,
  };
}

const LANDING_SUGGESTIONS = [
  'GLP-1 agonists and cardiovascular outcomes',
  'CRISPR in sickle cell disease',
  'Troponin elevation with normal coronaries',
  'Immunotherapy resistance mechanisms in NSCLC',
];

export default function App() {
  const [view, setView] = useState('home'); // 'home' | 'landing' | 'chat' | 'research'
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [landingInput, setLandingInput] = useState('');
  const [highlightsLoading, setHighlightsLoading] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const updateTab = useCallback((tabId, updates) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
    );
  }, []);

  const runSearch = useCallback(
    async (query, tabId) => {
      updateTab(tabId, { status: 'searching' });
      try {
        const conceptData = await extractConcepts(query);
        const concepts = conceptData.concepts || [];
        updateTab(tabId, { concepts });

        const paperData = await searchPapers(concepts);
        const papers = paperData.papers || [];
        updateTab(tabId, { papers });

        const [relData, sumData] = await Promise.all([
          analyzeRelationships(papers),
          summarizePapers(papers),
        ]);

        updateTab(tabId, {
          relationships: relData.relationships || [],
          summaries: sumData.summaries || {},
          status: 'graph',
        });
      } catch (err) {
        console.error('Search pipeline error:', err);
        updateTab(tabId, { status: 'graph' });
      }
    },
    [updateTab]
  );

  const handleNewSearch = useCallback(
    (query) => {
      if (!query?.trim()) return;
      const tabId = `tab-${Date.now()}`;
      const newTab = createTab(tabId, query);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
      setView('research');
      runSearch(query, tabId);
    },
    [runSearch]
  );

  const handleSelectPaper = useCallback(
    (paper) => {
      if (!activeTabId) return;
      updateTab(activeTabId, { selectedPaper: paper });

      // Fetch highlights if not cached
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === activeTabId);
        if (tab && !tab.highlights[paper.paperId]) {
          setHighlightsLoading(true);
          extractHighlights(paper)
            .then((data) => {
              setTabs((current) => {
                const currentTab = current.find((t) => t.id === activeTabId);
                if (!currentTab) return current;
                return current.map((t) =>
                  t.id === activeTabId
                    ? { ...t, highlights: { ...t.highlights, [paper.paperId]: data.highlights || [] } }
                    : t
                );
              });
            })
            .catch(() => {
              setTabs((current) =>
                current.map((t) =>
                  t.id === activeTabId
                    ? { ...t, highlights: { ...t.highlights, [paper.paperId]: [] } }
                    : t
                )
              );
            })
            .finally(() => setHighlightsLoading(false));
        }
        return prev;
      });
    },
    [activeTabId]
  );

  const handleOpenFullPaper = useCallback(
    (paper) => {
      if (!activeTabId) return;
      updateTab(activeTabId, { status: 'reading', selectedPaper: paper });

      // Auto-fetch highlights if not cached
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === activeTabId);
        if (tab && !tab.highlights[paper.paperId]) {
          setHighlightsLoading(true);
          extractHighlights(paper)
            .then((data) => {
              setTabs((current) =>
                current.map((t) =>
                  t.id === activeTabId
                    ? { ...t, highlights: { ...t.highlights, [paper.paperId]: data.highlights || [] } }
                    : t
                )
              );
            })
            .catch(() => {
              setTabs((current) =>
                current.map((t) =>
                  t.id === activeTabId
                    ? { ...t, highlights: { ...t.highlights, [paper.paperId]: [] } }
                    : t
                )
              );
            })
            .finally(() => setHighlightsLoading(false));
        }
        return prev;
      });
    },
    [activeTabId, updateTab]
  );

  const { trackQuestion, dismissTopic, suggestedTopics } = useTopicTracker();

  const handleAcceptTopic = useCallback(
    (topic) => {
      handleNewSearch(topic);
      dismissTopic(topic);
    },
    [handleNewSearch, dismissTopic]
  );

  const closeTab = useCallback((tabId) => {
    setTabs((prev) => {
      const updated = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId) {
        if (updated.length) {
          setActiveTabId(updated[updated.length - 1].id);
        } else {
          setActiveTabId(null);
          setView('home');
        }
      }
      return updated;
    });
  }, [activeTabId]);

  const handleLandingSubmit = (e) => {
    e.preventDefault();
    handleNewSearch(landingInput);
    setLandingInput('');
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo" onClick={() => setView('home')}>
          <div className="logo-icon">&#9670;</div>
          <span className="logo-text">ATLAS</span>
        </div>

        {view !== 'home' && (
          <nav className="header-nav">
            <button
              className={`nav-btn ${view === 'landing' ? 'active' : ''}`}
              onClick={() => setView('landing')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              Search
            </button>
            <button
              className={`nav-btn ${view === 'chat' ? 'active' : ''}`}
              onClick={() => setView('chat')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              Chat
            </button>
          </nav>
        )}

        {view === 'research' && (
          <div className="tabs-bar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab-btn ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span className={`tab-pulse ${tab.status}`} />
                <span className="tab-label">
                  {tab.query.slice(0, 25)}{tab.query.length > 25 ? '...' : ''}
                </span>
                <span
                  className="tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                >
                  &times;
                </span>
              </button>
            ))}
            <button className="tab-btn new-tab" onClick={() => setView('landing')}>
              + New Search
            </button>
          </div>
        )}
      </header>

      <PatternBanner
        suggestedTopics={suggestedTopics}
        onAccept={handleAcceptTopic}
        onDismiss={dismissTopic}
      />

      <main className="app-main">
        {/* Home — Choose your path */}
        {view === 'home' && (
          <div className="home-page">
            <div className="home-logo">
              <span className="home-logo-icon">&#9670;</span>
              ATLAS
            </div>
            <div className="home-tagline">AI-Powered Clinical Research Intelligence</div>
            <div className="home-prompt">What would you like to do?</div>

            <div className="home-cards">
              {/* Chat card */}
              <button className="home-card" onClick={() => setView('chat')}>
                <div className="home-card-icon home-card-icon--chat">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="home-card-title">AI Chat</div>
                <div className="home-card-desc">
                  Ask clinical questions, discuss treatments, get instant evidence-based answers from your AI research assistant.
                </div>
                <div className="home-card-cta">Start chatting &rarr;</div>
              </button>

              {/* Research card */}
              <button className="home-card" onClick={() => setView('landing')}>
                <div className="home-card-icon home-card-icon--research">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <circle cx="11" cy="11" r="3" />
                  </svg>
                </div>
                <div className="home-card-title">Deep Research</div>
                <div className="home-card-desc">
                  Search 200M+ papers, visualize knowledge graphs, read AI-annotated abstracts, and discover connections.
                </div>
                <div className="home-card-cta">Search papers &rarr;</div>
              </button>
            </div>

            <div className="home-footer">
              Powered by Semantic Scholar, Gemini &amp; Claude
            </div>
          </div>
        )}

        {/* Research Search Page */}
        {view === 'landing' && (
          <div className="landing-page">
            <div className="landing-logo">
              <span className="landing-logo-icon">&#9670;</span>
              ATLAS
            </div>
            <div className="landing-subtitle">Research Intelligence</div>
            <div className="landing-prompt">What do you want to understand?</div>
            <div className="landing-input-wrap">
              <form className="landing-input-form" onSubmit={handleLandingSubmit}>
                <input
                  type="text"
                  value={landingInput}
                  onChange={(e) => setLandingInput(e.target.value)}
                  placeholder="Describe a clinical question or topic..."
                />
                <button
                  type="submit"
                  className="landing-send-btn"
                  disabled={!landingInput.trim()}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                </button>
              </form>
            </div>
            <div className="landing-suggestions">
              {LANDING_SUGGESTIONS.map((s, i) => (
                <button key={i} className="landing-chip" onClick={() => handleNewSearch(s)}>
                  {s}
                </button>
              ))}
            </div>
            <button className="landing-chat-link" onClick={() => setView('chat')}>
              Try AI Chat &rarr;
            </button>
          </div>
        )}

        {/* Doctor Chat */}
        {view === 'chat' && (
          <DoctorChat onSwitchToResearch={(q) => { if (q) handleNewSearch(q); else setView('landing'); }} />
        )}

        {/* Research View */}
        {view === 'research' && activeTab && (
          <>
            {activeTab.status === 'searching' ? (
              <div className="loading-screen">
                <div className="loading-spinner" />
                <h2>Searching 200M+ papers...</h2>
                {activeTab.concepts.length > 0 && (
                  <div className="extracted-concepts">
                    <span className="concepts-label">Extracted Concepts</span>
                    <div className="concept-tags">
                      {activeTab.concepts.map((c, i) => (
                        <span key={i} className="concept-tag" style={{ animationDelay: `${i * 0.15}s` }}>
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="workspace">
                <div className="panel-left">
                  <PaperRanking
                    papers={activeTab.papers}
                    summaries={activeTab.summaries}
                    onSelectPaper={activeTab.status === 'reading' ? handleOpenFullPaper : handleSelectPaper}
                    selectedPaperId={activeTab.selectedPaper?.paperId}
                  />
                </div>
                <div className="panel-right">
                  {activeTab.status === 'reading' && activeTab.selectedPaper ? (
                    <>
                      <div className="paper-queue">
                        <button
                          className="back-to-graph-btn"
                          onClick={() => updateTab(activeTabId, { status: 'graph', selectedPaper: null })}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                          Graph
                        </button>
                        {activeTab.papers.map((p, i) => (
                          <button
                            key={p.paperId}
                            className={`paper-queue-item ${p.paperId === activeTab.selectedPaper?.paperId ? 'active' : ''}`}
                            onClick={() => handleOpenFullPaper(p)}
                          >
                            #{i + 1} {p.title?.slice(0, 30)}...
                          </button>
                        ))}
                      </div>
                      <PaperReader
                        paper={activeTab.selectedPaper}
                        highlights={activeTab.highlights[activeTab.selectedPaper?.paperId] || []}
                        highlightsLoading={highlightsLoading}
                        rankedPapers={activeTab.papers}
                        onSelectPaper={handleOpenFullPaper}
                      />
                    </>
                  ) : (
                    <ResearchGraph
                      papers={activeTab.papers}
                      relationships={activeTab.relationships}
                      summaries={activeTab.summaries}
                      onSelectPaper={handleSelectPaper}
                      onOpenFullPaper={handleOpenFullPaper}
                      selectedPaperId={activeTab.selectedPaper?.paperId}
                    />
                  )}
                </div>

                {/* Floating Agent — only in reading stage */}
                {activeTab.status === 'reading' && (
                  <AgentChat
                    paper={activeTab.selectedPaper}
                    highlights={activeTab.highlights[activeTab.selectedPaper?.paperId] || []}
                    onQuestion={trackQuestion}
                    onNewTab={handleNewSearch}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
