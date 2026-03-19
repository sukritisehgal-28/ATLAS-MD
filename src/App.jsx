import { useState, useCallback } from 'react';
import ClinicalInput from './components/ClinicalInput';
import ResearchGraph from './components/ResearchGraph';
import PaperRanking from './components/PaperRanking';
import AgentChat from './components/AgentChat';
import DoctorChat from './components/DoctorChat';
import PatternBanner from './components/PatternBanner';
import { useTopicTracker } from './hooks/useTopicTracker';
import {
  extractConcepts,
  searchPapers,
  analyzeRelationships,
  summarizePapers,
} from './services/api';
import './App.css';

function createTab(id, query) {
  return {
    id,
    query,
    status: 'idle',
    concepts: [],
    papers: [],
    relationships: [],
    summaries: {},
    selectedPaper: null,
    highlights: [],
  };
}

export default function App() {
  const [view, setView] = useState('chat'); // 'chat' | 'research'
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [showInput, setShowInput] = useState(true);

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
          status: 'reading',
        });
      } catch (err) {
        console.error('Search pipeline error:', err);
        updateTab(tabId, { status: 'idle' });
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
      setShowInput(false);
      setView('research');
      runSearch(query, tabId);
    },
    [runSearch]
  );

  const handleSelectPaper = useCallback(
    (paper) => {
      if (activeTabId) updateTab(activeTabId, { selectedPaper: paper });
    },
    [activeTabId, updateTab]
  );

  const handleHighlightsLoaded = useCallback(
    (highlights) => {
      if (activeTabId) updateTab(activeTabId, { highlights });
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
          setShowInput(true);
        }
      }
      return updated;
    });
  }, [activeTabId]);

  return (
    <div className="app">
      {/* Ambient background */}
      <div className="ambient-bg">
        <div className="ambient-orb orb-1" />
        <div className="ambient-orb orb-2" />
        <div className="ambient-orb orb-3" />
      </div>

      <header className="app-header">
        <div className="logo" onClick={() => setView('chat')}>
          <div className="logo-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <span className="logo-text">ATLAS</span>
          <span className="logo-badge">AI</span>
        </div>

        <nav className="header-nav">
          <button
            className={`nav-btn ${view === 'chat' ? 'active' : ''}`}
            onClick={() => setView('chat')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
          </button>
          <button
            className={`nav-btn ${view === 'research' ? 'active' : ''}`}
            onClick={() => { setView('research'); setShowInput(true); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Research
          </button>
        </nav>

        {view === 'research' && (
          <div className="tabs-bar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab-btn ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => { setActiveTabId(tab.id); setShowInput(false); }}
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
            <button className="tab-btn new-tab" onClick={() => setShowInput(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Search
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
        {view === 'chat' ? (
          <DoctorChat onSwitchToResearch={(q) => { if (q) handleNewSearch(q); else setView('research'); }} />
        ) : showInput || !activeTab ? (
          <ClinicalInput
            onSubmit={handleNewSearch}
            isLoading={activeTab?.status === 'searching'}
          />
        ) : activeTab.status === 'searching' ? (
          <div className="loading-screen">
            <div className="loading-helix">
              <div className="helix-strand strand-1" />
              <div className="helix-strand strand-2" />
              <div className="helix-strand strand-3" />
            </div>
            <h2>Analyzing Clinical Literature</h2>
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
            <div className="loading-steps">
              <div className="step active">
                <span className="step-dot" />
                <span>Querying Semantic Scholar</span>
              </div>
              <div className="step">
                <span className="step-dot" />
                <span>Mapping relationships</span>
              </div>
              <div className="step">
                <span className="step-dot" />
                <span>Generating summaries</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="panel-left">
              <PaperRanking
                papers={activeTab.papers}
                summaries={activeTab.summaries}
                onSelectPaper={handleSelectPaper}
                selectedPaperId={activeTab.selectedPaper?.paperId}
              />
              <AgentChat
                paper={activeTab.selectedPaper}
                highlights={activeTab.highlights}
                onQuestion={trackQuestion}
              />
            </div>
            <div className="panel-right">
              <ResearchGraph
                papers={activeTab.papers}
                relationships={activeTab.relationships}
                summaries={activeTab.summaries}
                onSelectPaper={handleSelectPaper}
                selectedPaperId={activeTab.selectedPaper?.paperId}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
