import { useState, useCallback, useEffect } from 'react';
import ResearchGraph from './components/ResearchGraph';
import PaperRanking from './components/PaperRanking';
import PaperReader from './components/PaperReader';
import AgentChat from './components/AgentChat';
import DoctorChat from './components/DoctorChat';
import PatternBanner from './components/PatternBanner';
import LoginPage from './components/LoginPage';
import SettingsPage from './components/SettingsPage';
import { useTopicTracker } from './hooks/useTopicTracker';
import { useSession } from './hooks/useSession';
import {
  verifyToken,
  extractConcepts,
  searchPapers,
  analyzeRelationships,
  summarizePapers,
  extractHighlights,
  buildReadingList,
  extendReadingList,
  generateBrief,
  getEvidenceStrength,
  searchClinicalTrials,
  comparePapers,
  getCitationChain,
  createSession,
  joinSession,
  listSessions,
  deleteAccount,
  saveResearchMemory,
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
    evidence: {},
    selectedPaper: null,
  };
}

// Bookmarks persistence — scoped per user
function loadBookmarks(userId) {
  try {
    return JSON.parse(localStorage.getItem(`atlas-bookmarks-${userId}`) || '[]');
  } catch { return []; }
}
function saveBookmarks(bookmarks, userId) {
  localStorage.setItem(`atlas-bookmarks-${userId}`, JSON.stringify(bookmarks));
}

const LANDING_SUGGESTIONS = [
  'GLP-1 agonists and cardiovascular outcomes',
  'CRISPR in sickle cell disease',
  'Troponin elevation with normal coronaries',
  'Immunotherapy resistance mechanisms in NSCLC',
];

function loadTheme() {
  return localStorage.getItem('atlas-theme') || 'dark';
}

// The clinical brief is model-generated text summarising third-party abstracts,
// so it is untrusted input. Escape it before the markdown-ish formatting below
// turns it into HTML.
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState(loadTheme);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('atlas-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => t === 'dark' ? 'light' : 'dark');

  // Check for existing session on mount
  useEffect(() => {
    verifyToken()
      .then((u) => { if (u) setUser(u); })
      .finally(() => setAuthLoading(false));

    // Listen for auth expiry from API layer
    const handleExpired = () => { setUser(null); };
    window.addEventListener('atlas-auth-expired', handleExpired);
    return () => window.removeEventListener('atlas-auth-expired', handleExpired);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('atlas-token');
    setUser(null);
  };

  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onAuth={setUser} />;
  }

  return <AuthenticatedApp user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />;
}

function AuthenticatedApp({ user, onLogout, theme, onToggleTheme }) {
  const [view, setView] = useState('home'); // 'home' | 'landing' | 'chat' | 'research'
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [landingInput, setLandingInput] = useState('');
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionInput, setSessionInput] = useState('');
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [sessionList, setSessionList] = useState([]);
  const [sessionListLoading, setSessionListLoading] = useState(false);

  const session = useSession(user);
  const [mirrorMode, setMirrorMode] = useState(true); // members default to mirrored view

  const [sessionNotes, setSessionNotes] = useState([]);
  const [showSessionChat, setShowSessionChat] = useState(false);
  const [sessionChatInput, setSessionChatInput] = useState('');
  const [readingList, setReadingList] = useState(null);
  const [readingListLoading, setReadingListLoading] = useState(false);
  const [showReadingList, setShowReadingList] = useState(false);
  const [readingListExpanded, setReadingListExpanded] = useState(false);
  const [extendingReadingList, setExtendingReadingList] = useState(false);
  const [showReadingListForm, setShowReadingListForm] = useState(false);
  const [readingProfile, setReadingProfile] = useState({ experience: '', role: '', purpose: '', specialty: '', depth: '' });
  const [briefContent, setBriefContent] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [searchContext, setSearchContext] = useState(null);
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(user.id));
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [rankingCollapsed, setRankingCollapsed] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonData, setComparisonData] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonSelection, setComparisonSelection] = useState([]);
  const [showComparisonPicker, setShowComparisonPicker] = useState(false);
  const [showTrials, setShowTrials] = useState(false);
  const [trialsData, setTrialsData] = useState(null);
  const [trialsMessage, setTrialsMessage] = useState('');
  const [trialsLoading, setTrialsLoading] = useState(false);
  const [showCitationChain, setShowCitationChain] = useState(false);
  const [citationChainPaper, setCitationChainPaper] = useState(null);
  const [citationChainData, setCitationChainData] = useState({ citations: [], references: [] });
  const [citationChainLoading, setCitationChainLoading] = useState(false);
  const [agentMessages, setAgentMessages] = useState([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [doctorMessages, setDoctorMessages] = useState([]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Mirror mode: members see the host's state
  const isMember = session.isInSession && !session.isHost;
  const showMirror = isMember && mirrorMode && session.hostSnapshot;
  const displayView = showMirror ? session.hostSnapshot.view : view;
  const displayTabs = showMirror ? session.hostSnapshot.tabs : tabs;
  const displayActiveTabId = showMirror ? session.hostSnapshot.activeTabId : activeTabId;
  const displayActiveTab = displayTabs.find((t) => t.id === displayActiveTabId);

  // Host broadcasts state to members
  useEffect(() => {
    if (!session.isInSession || !session.isHost) return;
    session.emitStateSnapshot({
      view,
      activeTabId,
      tabs: tabs.map((t) => ({
        id: t.id,
        query: t.query,
        status: t.status,
        concepts: t.concepts,
        papers: t.papers,
        relationships: t.relationships,
        summaries: t.summaries,
        highlights: t.highlights,
        evidence: t.evidence,
        selectedPaper: t.selectedPaper,
      })),
      // Additional UI state for full sync
      showReadingList,
      readingList,
      readingListLoading,
      showBrief,
      briefContent,
      briefLoading,
      showComparison,
      comparisonData,
      comparisonLoading,
      showTrials,
      trialsData,
      trialsMessage,
      trialsLoading,
      agentMessages,
      agentOpen,
      doctorMessages,
    });
  }, [view, activeTabId, tabs, session, showReadingList, readingList, readingListLoading, showBrief, briefContent, briefLoading, showComparison, comparisonData, comparisonLoading, showTrials, trialsData, trialsMessage, trialsLoading, agentMessages, agentOpen, doctorMessages]);

  const updateTab = useCallback((tabId, updates) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
    );
  }, []);

  const runSearch = useCallback(
    async (query, tabId, fromChat = false) => {
      updateTab(tabId, { status: 'searching' });

      if (fromChat) {
        setSearchContext({ fromChat: true, stage: 'analyzing', concepts: [], query });
        // Animate stages
        await new Promise((r) => setTimeout(r, 1200));
        setSearchContext((prev) => ({ ...prev, stage: 'extracting' }));
      }

      try {
        const conceptData = await extractConcepts(query);
        const concepts = conceptData.concepts || [];
        updateTab(tabId, { concepts });

        if (fromChat) {
          setSearchContext((prev) => ({ ...prev, stage: 'searching', concepts }));
        }

        const paperData = await searchPapers(concepts);
        const papers = paperData.papers || [];
        updateTab(tabId, { papers });

        if (fromChat) {
          setSearchContext((prev) => ({ ...prev, stage: 'mapping', paperCount: papers.length }));
        }

        const [relData, sumData, evidenceData] = await Promise.all([
          analyzeRelationships(papers),
          summarizePapers(papers),
          getEvidenceStrength(papers).catch(() => ({ evidence: {} })),
        ]);

        updateTab(tabId, {
          relationships: relData.relationships || [],
          summaries: sumData.summaries || {},
          evidence: evidenceData.evidence || {},
          status: 'graph',
        });
        setSearchContext(null);

        // Save to cross-session memory
        const topPapers = papers.slice(0, 5).map((p) => ({ title: p.title, year: p.year, paperId: p.paperId }));
        saveResearchMemory(query, concepts, papers.length, topPapers, '').catch(() => {});
      } catch (err) {
        console.error('Search pipeline error:', err);
        updateTab(tabId, { status: 'graph' });
        setSearchContext(null);
      }
    },
    [updateTab]
  );

  const handleNewSearch = useCallback(
    (query, { fromChat } = {}) => {
      if (!query?.trim()) return;
      const tabId = `tab-${Date.now()}`;
      const newTab = createTab(tabId, query);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
      setView('research');
      runSearch(query, tabId, fromChat);
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

  const handleAddNote = useCallback((note) => {
    setSessionNotes((prev) => {
      if (prev.includes(note)) return prev;
      return [...prev, note].slice(-20);
    });
  }, []);

  const handleSearchNewer = useCallback((title) => {
    if (!title?.trim()) return;
    const tabId = `tab-${Date.now()}`;
    const newTab = createTab(tabId, `Recent: ${title.slice(0, 50)}`);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setView('research');
    // Search with year filter for last 3 years only
    const currentYear = new Date().getFullYear();
    const yearRange = `${currentYear - 3}-${currentYear}`;
    (async () => {
      updateTab(tabId, { status: 'searching' });
      try {
        const conceptData = await extractConcepts(title);
        const concepts = conceptData.concepts || [];
        updateTab(tabId, { concepts });
        const paperData = await searchPapers(concepts, yearRange);
        const papers = paperData.papers || [];
        updateTab(tabId, { papers });
        const [relData, sumData, evidenceData] = await Promise.all([
          analyzeRelationships(papers),
          summarizePapers(papers),
          getEvidenceStrength(papers).catch(() => ({ evidence: {} })),
        ]);
        updateTab(tabId, {
          relationships: relData.relationships || [],
          summaries: sumData.summaries || {},
          evidence: evidenceData.evidence || {},
          status: 'graph',
        });
      } catch (err) {
        console.error('Search newer error:', err);
        updateTab(tabId, { status: 'graph' });
      }
    })();
  }, [updateTab]);

  const handleBuildReadingList = useCallback(() => {
    if (!activeTab) return;
    setShowReadingListForm(true);
  }, [activeTab]);

  const submitReadingList = useCallback(async (profile) => {
    if (!activeTab || readingListLoading) return;
    setShowReadingListForm(false);
    setReadingListLoading(true);
    setShowReadingList(true);
    setReadingListExpanded(false);
    try {
      const data = await buildReadingList(activeTab.papers, activeTab.query, profile);
      setReadingList(data.readingList || []);
    } catch (err) {
      console.error('Reading list error:', err);
      setReadingList([]);
    } finally {
      setReadingListLoading(false);
    }
  }, [activeTab, readingListLoading]);

  const handleExtendReadingList = useCallback(async () => {
    if (!activeTab || extendingReadingList || !readingList?.length) return;
    setExtendingReadingList(true);
    try {
      const existingIds = readingList.map((item) => item.paperId);
      const data = await extendReadingList(activeTab.papers, activeTab.query, readingProfile, existingIds);
      const more = data.readingList || [];
      setReadingList((prev) => [...(prev || []), ...more]);
      setReadingListExpanded(true);
    } catch (err) {
      console.error('Extend reading list error:', err);
    } finally {
      setExtendingReadingList(false);
    }
  }, [activeTab, extendingReadingList, readingList, readingProfile]);

  const handleGenerateBrief = useCallback(async () => {
    if (!activeTab || briefLoading) return;
    setBriefLoading(true);
    setShowBrief(true);
    try {
      const data = await generateBrief(activeTab.papers, activeTab.highlights, activeTab.query);
      setBriefContent(data.brief || 'No brief generated.');
    } catch (err) {
      console.error('Brief error:', err);
      setBriefContent('Failed to generate brief.');
    } finally {
      setBriefLoading(false);
    }
  }, [activeTab, briefLoading]);

  // Bookmark handlers
  const toggleBookmark = useCallback((paper) => {
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.paperId === paper.paperId);
      const updated = exists
        ? prev.filter((b) => b.paperId !== paper.paperId)
        : [...prev, { paperId: paper.paperId, title: paper.title, year: paper.year, authors: paper.authors?.slice(0, 2), citationCount: paper.citationCount, abstract: paper.abstract?.slice(0, 200), savedAt: Date.now() }];
      saveBookmarks(updated, user.id);
      return updated;
    });
  }, []);

  const isBookmarked = useCallback((paperId) => bookmarks.some((b) => b.paperId === paperId), [bookmarks]);

  // Comparison table
  const handleCompare = useCallback(async () => {
    if (!activeTab || comparisonSelection.length < 2) return;
    const selectedPapers = comparisonSelection.map((id) => activeTab.papers.find((p) => p.paperId === id)).filter(Boolean);
    setShowComparisonPicker(false);
    setComparisonLoading(true);
    setShowComparison(true);
    try {
      const data = await comparePapers(selectedPapers);
      setComparisonData(data);
    } catch (err) {
      console.error('Compare error:', err);
      setComparisonData(null);
    } finally {
      setComparisonLoading(false);
    }
  }, [activeTab, comparisonSelection]);

  // Clinical trials
  const handleSearchTrials = useCallback(async () => {
    if (!activeTab) return;
    setTrialsLoading(true);
    setShowTrials(true);
    setTrialsMessage('');
    try {
      const data = await searchClinicalTrials(activeTab.query);
      setTrialsData(data.trials || []);
      setTrialsMessage(data.message || '');
    } catch (err) {
      console.error('Trials error:', err);
      setTrialsData([]);
      setTrialsMessage('Could not reach ClinicalTrials.gov. Please try again.');
    } finally {
      setTrialsLoading(false);
    }
  }, [activeTab]);

  // Citation chain
  const handleCitationChain = useCallback(async (paper) => {
    setCitationChainPaper(paper);
    setCitationChainLoading(true);
    setShowCitationChain(true);
    setCitationChainData({ citations: [], references: [] });
    try {
      const [citData, refData] = await Promise.all([
        getCitationChain(paper.paperId, 'citations'),
        getCitationChain(paper.paperId, 'references'),
      ]);
      setCitationChainData({
        citations: citData.papers || [],
        references: refData.papers || [],
      });
    } catch (err) {
      console.error('Citation chain error:', err);
    } finally {
      setCitationChainLoading(false);
    }
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    await deleteAccount();
    localStorage.removeItem('atlas-token');
    localStorage.removeItem(`atlas-bookmarks-${user.id}`);
    localStorage.removeItem('atlas-theme');
    localStorage.removeItem('atlas-api-keys');
    onLogout();
  }, [user, onLogout]);

  const handleLandingSubmit = (e) => {
    e.preventDefault();
    handleNewSearch(landingInput);
    setLandingInput('');
  };

  // For rendering: use mirrored state if member is in mirror mode
  const renderView = displayView;
  const renderActiveTab = displayActiveTab;
  const renderTabs = displayTabs;

  // Mirrored UI state for panels
  const snap = session.hostSnapshot;
  const renderShowReadingList = showMirror ? snap.showReadingList : showReadingList;
  const renderReadingList = showMirror ? snap.readingList : readingList;
  const renderReadingListLoading = showMirror ? snap.readingListLoading : readingListLoading;
  const renderShowBrief = showMirror ? snap.showBrief : showBrief;
  const renderBriefContent = showMirror ? snap.briefContent : briefContent;
  const renderBriefLoading = showMirror ? snap.briefLoading : briefLoading;
  const renderShowComparison = showMirror ? snap.showComparison : showComparison;
  const renderComparisonData = showMirror ? snap.comparisonData : comparisonData;
  const renderComparisonLoading = showMirror ? snap.comparisonLoading : comparisonLoading;
  const renderShowTrials = showMirror ? snap.showTrials : showTrials;
  const renderTrialsData = showMirror ? snap.trialsData : trialsData;
  const renderTrialsMessage = showMirror ? snap.trialsMessage : trialsMessage;
  const renderTrialsLoading = showMirror ? snap.trialsLoading : trialsLoading;
  const renderAgentMessages = showMirror ? snap.agentMessages : agentMessages;
  const renderAgentOpen = showMirror ? snap.agentOpen : agentOpen;
  const renderDoctorMessages = showMirror ? (snap.doctorMessages || []) : doctorMessages;

  // Draggable session bar state
  const [pressDrag, setPressDrag] = useState(null);
  const [presencePos, setPresencePos] = useState({ x: null, y: null });
  const [chatDrag, setChatDrag] = useState(null);
  const [chatPos, setChatPos] = useState({ x: null, y: null });

  return (
    <div className="app">
      {/* Mirror mode banner */}
      {showMirror && (
        <div className="mirror-banner">
          <div className="mirror-banner-live" />
          <span>Viewing <strong>{session.hostName}</strong>'s research session</span>
          <button className="mirror-banner-btn" onClick={() => setMirrorMode(false)}>
            Switch to My View
          </button>
        </div>
      )}
      {/* Member's own portal (small box) when in mirror mode */}
      {isMember && !mirrorMode && (
        <div className="mirror-banner mirror-banner-own">
          <span>Your own view</span>
          <button className="mirror-banner-btn" onClick={() => setMirrorMode(true)}>
            Back to Host View
          </button>
        </div>
      )}
      <header className="app-header">
        <div className="logo" onClick={() => setView('home')}>
          <div className="logo-icon">&#9670;</div>
          <span className="logo-text">ATLAS</span>
        </div>

        {renderView !== 'home' && (
          <nav className="header-nav">
            <button
              className={`nav-btn ${renderView === 'landing' ? 'active' : ''}`}
              onClick={() => setView('landing')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              Search
            </button>
            <button
              className={`nav-btn ${renderView === 'chat' ? 'active' : ''}`}
              onClick={() => setView('chat')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              Chat
            </button>
            <button
              className={`nav-btn ${showBookmarks ? 'active' : ''}`}
              onClick={() => setShowBookmarks(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
              Saved{bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}
            </button>
          </nav>
        )}

        <div className="header-user">
          {session.isInSession ? (
            <div className="session-indicator" onClick={() => setShowSessionModal(true)}>
              <div className="session-live-dot" />
              <span className="session-indicator-text">{session.sessionName}</span>
              <div className="session-member-count">{session.members.length}</div>
            </div>
          ) : (
            <button
              className="session-btn"
              onClick={async () => {
                setShowSessionModal(true);
                setSessionListLoading(true);
                try {
                  const data = await listSessions();
                  setSessionList(data.sessions || []);
                } catch { /* ignore */ }
                setSessionListLoading(false);
              }}
              title="Collaborate"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </button>
          )}
          <span className="header-user-name">{user.name}</span>
          <button className="header-settings-btn" onClick={() => setShowSettings(true)} title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        {renderView === 'research' && (
          <div className="tabs-bar">
            {renderTabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab-btn ${tab.id === displayActiveTabId ? 'active' : ''}`}
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
        {renderView === 'home' && (
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
                  Search research papers, visualize knowledge graphs, read AI-annotated abstracts, and discover connections.
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
        {renderView === 'landing' && (
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
        {renderView === 'chat' && (
          <DoctorChat
            onSwitchToResearch={(q) => { if (q) handleNewSearch(q, { fromChat: true }); else setView('landing'); }}
            doctorMessages={renderDoctorMessages}
            onDoctorMessagesChange={showMirror ? undefined : setDoctorMessages}
          />
        )}

        {/* Research View */}
        {renderView === 'research' && renderActiveTab && (
          <>
            {renderActiveTab.status === 'searching' ? (
              <div className="loading-screen">
                <div className="loading-spinner" />

                {/* Animated search process for chat-to-research redirect */}
                {searchContext?.fromChat ? (
                  <div className="search-process">
                    <div className={`search-step ${searchContext.stage === 'analyzing' ? 'active' : searchContext.stage !== 'analyzing' ? 'done' : ''}`}>
                      <span className="search-step-icon">{searchContext.stage === 'analyzing' ? '...' : '✓'}</span>
                      <span>Analyzing conversation memory...</span>
                    </div>
                    {(searchContext.stage === 'extracting' || searchContext.stage === 'searching' || searchContext.stage === 'mapping') && (
                      <div className={`search-step ${searchContext.stage === 'extracting' ? 'active' : 'done'}`}>
                        <span className="search-step-icon">{searchContext.stage === 'extracting' ? '...' : '✓'}</span>
                        <span>Extracting medical concepts from your discussion...</span>
                      </div>
                    )}
                    {(searchContext.stage === 'searching' || searchContext.stage === 'mapping') && (
                      <div className={`search-step ${searchContext.stage === 'searching' ? 'active' : 'done'}`}>
                        <span className="search-step-icon">{searchContext.stage === 'searching' ? '...' : '✓'}</span>
                        <span>Searching papers for: <strong>{searchContext.query}</strong></span>
                      </div>
                    )}
                    {searchContext.stage === 'mapping' && (
                      <div className="search-step active">
                        <span className="search-step-icon">...</span>
                        <span>Mapping relationships across {searchContext.paperCount} papers...</span>
                      </div>
                    )}
                    {searchContext.concepts?.length > 0 && (
                      <div className="extracted-concepts" style={{ marginTop: 16 }}>
                        <span className="concepts-label">Concepts Found</span>
                        <div className="concept-tags">
                          {searchContext.concepts.map((c, i) => (
                            <span key={i} className="concept-tag" style={{ animationDelay: `${i * 0.15}s` }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="search-process">
                    <div className={`search-step ${renderActiveTab.concepts.length === 0 ? 'active' : 'done'}`}>
                      <span className="search-step-icon">{renderActiveTab.concepts.length === 0 ? '...' : '✓'}</span>
                      <span>Extracting clinical concepts from your query...</span>
                    </div>
                    {renderActiveTab.concepts.length > 0 && (
                      <>
                        <div className={`search-step ${renderActiveTab.papers.length === 0 ? 'active' : 'done'}`}>
                          <span className="search-step-icon">{renderActiveTab.papers.length === 0 ? '...' : '✓'}</span>
                          <span>Searching research papers...</span>
                        </div>
                        <div className="extracted-concepts" style={{ marginTop: 12 }}>
                          <span className="concepts-label">Concepts Found</span>
                          <div className="concept-tags">
                            {renderActiveTab.concepts.map((c, i) => (
                              <span key={i} className="concept-tag" style={{ animationDelay: `${i * 0.15}s` }}>{c}</span>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="workspace">
                <div className={`panel-left ${rankingCollapsed ? 'panel-left-collapsed' : ''}`}>
                  <button
                    className="panel-toggle-btn"
                    onClick={() => setRankingCollapsed((prev) => !prev)}
                    title={rankingCollapsed ? 'Expand papers' : 'Collapse papers'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {rankingCollapsed
                        ? <polyline points="9 18 15 12 9 6" />
                        : <polyline points="15 18 9 12 15 6" />
                      }
                    </svg>
                    {rankingCollapsed && <span className="panel-toggle-label">Papers</span>}
                  </button>
                  {!rankingCollapsed && (
                    <PaperRanking
                      papers={renderActiveTab.papers}
                      summaries={renderActiveTab.summaries}
                      evidence={renderActiveTab.evidence}
                      onSelectPaper={handleOpenFullPaper}
                      selectedPaperId={renderActiveTab.selectedPaper?.paperId}
                      bookmarks={bookmarks}
                      onToggleBookmark={toggleBookmark}
                      isBookmarked={isBookmarked}
                    />
                  )}
                </div>
                <div className="panel-right">
                  {renderActiveTab.status === 'reading' && renderActiveTab.selectedPaper ? (
                    <>
                      <div className="paper-queue">
                        <button
                          className="back-to-graph-btn"
                          onClick={() => updateTab(activeTabId, { status: 'graph', selectedPaper: null })}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                          Graph
                        </button>
                        {renderActiveTab.papers.map((p, i) => (
                          <button
                            key={p.paperId}
                            className={`paper-queue-item ${p.paperId === renderActiveTab.selectedPaper?.paperId ? 'active' : ''}`}
                            onClick={() => handleOpenFullPaper(p)}
                          >
                            #{i + 1} {p.title?.slice(0, 30)}...
                          </button>
                        ))}
                      </div>
                      <PaperReader
                        paper={renderActiveTab.selectedPaper}
                        highlights={renderActiveTab.highlights[renderActiveTab.selectedPaper?.paperId] || []}
                        highlightsLoading={highlightsLoading}
                        rankedPapers={renderActiveTab.papers}
                        onSelectPaper={handleOpenFullPaper}
                        onSearchNewer={handleSearchNewer}
                        isBookmarked={isBookmarked}
                        onToggleBookmark={toggleBookmark}
                        evidence={renderActiveTab.evidence}
                      />
                    </>
                  ) : (
                    <ResearchGraph
                      papers={renderActiveTab.papers}
                      relationships={renderActiveTab.relationships}
                      summaries={renderActiveTab.summaries}
                      evidence={renderActiveTab.evidence}
                      onSelectPaper={handleSelectPaper}
                      onOpenFullPaper={handleOpenFullPaper}
                      selectedPaperId={renderActiveTab.selectedPaper?.paperId}
                      onCitationChain={handleCitationChain}
                      isBookmarked={isBookmarked}
                      onToggleBookmark={toggleBookmark}
                    />
                  )}
                </div>

                {/* Floating Agent — available in both graph and reading views */}
                <AgentChat
                  paper={renderActiveTab.selectedPaper || (renderActiveTab.papers.length > 0 ? { paperId: 'all', title: `All ${renderActiveTab.papers.length} papers on "${renderActiveTab.query}"`, abstract: renderActiveTab.papers.map(p => p.title).join('; '), year: '' } : null)}
                  highlights={renderActiveTab.selectedPaper ? (renderActiveTab.highlights[renderActiveTab.selectedPaper?.paperId] || []) : []}
                  onQuestion={trackQuestion}
                  onNewTab={handleNewSearch}
                  onSwitchToChat={() => setView('chat')}
                  sessionNotes={sessionNotes}
                  onAddNote={handleAddNote}
                  allPapers={renderActiveTab.papers}
                  agentMessages={renderAgentMessages}
                  onAgentMessagesChange={showMirror ? undefined : setAgentMessages}
                  agentOpen={renderAgentOpen}
                  onAgentOpenChange={showMirror ? undefined : setAgentOpen}
                />

                {/* Research tools bar */}
                {renderActiveTab.status !== 'searching' && (
                  <div className="research-tools-bar">
                    <button className="research-tool-btn" onClick={handleBuildReadingList} disabled={readingListLoading}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                      Reading List
                    </button>
                    <button className="research-tool-btn" onClick={handleGenerateBrief} disabled={briefLoading}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      Research Brief
                    </button>
                    <button className="research-tool-btn" onClick={() => { setComparisonSelection([]); setShowComparisonPicker(true); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                      Compare Papers
                    </button>
                    <button className="research-tool-btn" onClick={handleSearchTrials} disabled={trialsLoading}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
                      Clinical Trials
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Reading List Questionnaire Modal */}
      {showReadingListForm && (
        <div className="modal-overlay" onClick={() => setShowReadingListForm(false)}>
          <div className="modal-panel reading-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                PERSONALIZE YOUR READING LIST
              </div>
              <button className="modal-close" onClick={() => setShowReadingListForm(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={(e) => { e.preventDefault(); submitReadingList(readingProfile); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>How many years of clinical experience?</label>
                  <select
                    value={readingProfile.experience}
                    onChange={(e) => setReadingProfile((p) => ({ ...p, experience: e.target.value }))}
                    style={{ background: 'var(--bg-surface, #1e293b)', color: 'var(--text-primary, #e2e8f0)', border: '1px solid var(--border, #334155)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}
                  >
                    <option value="">Select...</option>
                    <option value="Student">Student</option>
                    <option value="1-3 years">1-3 years</option>
                    <option value="3-10 years">3-10 years</option>
                    <option value="10+ years">10+ years</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>What's your role?</label>
                  <select
                    value={readingProfile.role}
                    onChange={(e) => setReadingProfile((p) => ({ ...p, role: e.target.value }))}
                    style={{ background: 'var(--bg-surface, #1e293b)', color: 'var(--text-primary, #e2e8f0)', border: '1px solid var(--border, #334155)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}
                  >
                    <option value="">Select...</option>
                    <option value="Medical student">Medical student</option>
                    <option value="Resident">Resident</option>
                    <option value="Fellow">Fellow</option>
                    <option value="Attending physician">Attending physician</option>
                    <option value="Researcher">Researcher</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>What's the purpose?</label>
                  <select
                    value={readingProfile.purpose}
                    onChange={(e) => setReadingProfile((p) => ({ ...p, purpose: e.target.value }))}
                    style={{ background: 'var(--bg-surface, #1e293b)', color: 'var(--text-primary, #e2e8f0)', border: '1px solid var(--border, #334155)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}
                  >
                    <option value="">Select...</option>
                    <option value="Just curious">Just curious</option>
                    <option value="Treating a patient">Treating a patient</option>
                    <option value="Writing a paper">Writing a paper</option>
                    <option value="Preparing for rounds">Preparing for rounds</option>
                    <option value="Board prep">Board prep</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>What's your specialty?</label>
                  <input
                    type="text"
                    value={readingProfile.specialty}
                    onChange={(e) => setReadingProfile((p) => ({ ...p, specialty: e.target.value }))}
                    placeholder="e.g. Cardiology, Oncology, Internal Medicine..."
                    style={{ background: 'var(--bg-surface, #1e293b)', color: 'var(--text-primary, #e2e8f0)', border: '1px solid var(--border, #334155)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>How deep do you want to go?</label>
                  <select
                    value={readingProfile.depth}
                    onChange={(e) => setReadingProfile((p) => ({ ...p, depth: e.target.value }))}
                    style={{ background: 'var(--bg-surface, #1e293b)', color: 'var(--text-primary, #e2e8f0)', border: '1px solid var(--border, #334155)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}
                  >
                    <option value="">Select...</option>
                    <option value="Quick overview">Quick overview</option>
                    <option value="Moderate depth">Moderate depth</option>
                    <option value="Deep dive">Deep dive</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 0', fontSize: 13, letterSpacing: 1, marginTop: 8 }}
                >
                  Build My Reading List
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Reading List Results Modal */}
      {renderShowReadingList && (
        <div className="modal-overlay" onClick={() => setShowReadingList(false)}>
          <div className="modal-panel reading-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                AI READING LIST
              </div>
              <button className="modal-close" onClick={() => setShowReadingList(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {renderReadingListLoading ? (
                <div className="modal-loading">
                  <div className="loading-spinner" />
                  <p>Ranking all {activeTab?.papers?.length || ''} papers for you...</p>
                </div>
              ) : renderReadingList?.length ? (
                <>
                  {/* Start Reading button — opens the #1 ranked paper */}
                  <button
                    className="start-reading-btn"
                    onClick={() => {
                      const topPaper = activeTab?.papers.find((p) => p.paperId === renderReadingList[0]?.paperId);
                      if (topPaper) {
                        handleOpenFullPaper(topPaper);
                        setShowReadingList(false);
                      }
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Start Reading — Begin with #{1} ranked paper
                  </button>
                  <div className="reading-list-items">
                    {renderReadingList.map((item, i) => {
                      const paper = activeTab?.papers.find((p) => p.paperId === item.paperId);
                      return (
                        <div key={i} className="reading-list-item" onClick={() => { if (paper) { handleOpenFullPaper(paper); setShowReadingList(false); } }}>
                          <div className="reading-list-number">{i + 1}</div>
                          <div className="reading-list-content">
                            <div className="reading-list-paper-title">{paper?.title || item.paperId}</div>
                            <div className="reading-list-reason">{item.reason}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Show More button — loads remaining papers */}
                  {!readingListExpanded && activeTab?.papers?.length > renderReadingList.length && (
                    <button
                      className="show-more-btn"
                      onClick={handleExtendReadingList}
                      disabled={extendingReadingList}
                    >
                      {extendingReadingList ? (
                        <>
                          <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                          Ranking remaining papers...
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                          Show {activeTab.papers.length - renderReadingList.length} more papers
                        </>
                      )}
                    </button>
                  )}
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No reading list available.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Research Brief Modal */}
      {renderShowBrief && (
        <div className="modal-overlay" onClick={() => setShowBrief(false)}>
          <div className="modal-panel brief-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                RESEARCH BRIEF
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => {
                  const blob = new Blob([renderBriefContent || ''], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `research-brief-${activeTab?.query?.slice(0, 30) || 'atlas'}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}>
                  Export
                </button>
                <button className="modal-close" onClick={() => setShowBrief(false)}>&times;</button>
              </div>
            </div>
            <div className="modal-body brief-body">
              {renderBriefLoading ? (
                <div className="modal-loading">
                  <div className="loading-spinner" />
                  <p>Generating your clinical research brief...</p>
                </div>
              ) : (
                <div className="brief-content" dangerouslySetInnerHTML={{
                  __html: escapeHtml(renderBriefContent || '')
                    .replace(/^### (.*)/gm, '<h4>$1</h4>')
                    .replace(/^## (.*)/gm, '<h3>$1</h3>')
                    .replace(/^# (.*)/gm, '<h3>$1</h3>')
                    .replace(/\*\*(.+?)\*\*:?/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/^[-•]\s+/gm, '&bull; ')
                    .replace(/\n/g, '<br/>')
                }} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bookmarks Modal */}
      {showBookmarks && (
        <div className="modal-overlay" onClick={() => setShowBookmarks(false)}>
          <div className="modal-panel reading-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                SAVED PAPERS ({bookmarks.length})
              </div>
              <button className="modal-close" onClick={() => setShowBookmarks(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {bookmarks.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
                  No saved papers yet. Click the bookmark icon on any paper to save it.
                </p>
              ) : (
                <div className="reading-list-items">
                  {bookmarks.map((bk, i) => (
                    <div key={bk.paperId} className="reading-list-item" style={{ cursor: 'default' }}>
                      <div className="reading-list-number">{i + 1}</div>
                      <div className="reading-list-content">
                        <div className="reading-list-paper-title">{bk.title}</div>
                        <div className="reading-list-reason">
                          {bk.year} &middot; {bk.citationCount || 0} citations &middot;
                          {bk.authors?.map((a) => a.name).join(', ')}
                        </div>
                      </div>
                      <button
                        className="bookmark-remove-btn"
                        onClick={() => toggleBookmark(bk)}
                        title="Remove bookmark"
                        style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 18, padding: '4px 8px' }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comparison Picker Modal */}
      {showComparisonPicker && activeTab && (
        <div className="modal-overlay" onClick={() => setShowComparisonPicker(false)}>
          <div className="modal-panel reading-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/></svg>
                SELECT PAPERS TO COMPARE (2-4)
              </div>
              <button className="modal-close" onClick={() => setShowComparisonPicker(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="reading-list-items">
                {activeTab.papers.map((paper) => {
                  const selected = comparisonSelection.includes(paper.paperId);
                  return (
                    <div
                      key={paper.paperId}
                      className={`reading-list-item ${selected ? 'selected' : ''}`}
                      onClick={() => {
                        setComparisonSelection((prev) =>
                          selected
                            ? prev.filter((id) => id !== paper.paperId)
                            : prev.length < 4 ? [...prev, paper.paperId] : prev
                        );
                      }}
                      style={{ cursor: 'pointer', border: selected ? '1px solid var(--accent)' : '1px solid transparent', borderRadius: 8 }}
                    >
                      <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 12, color: '#fff', fontSize: 12, fontWeight: 700 }}>
                        {selected ? '✓' : ''}
                      </div>
                      <div className="reading-list-content">
                        <div className="reading-list-paper-title">{paper.title}</div>
                        <div className="reading-list-reason">{paper.year} &middot; {paper.citationCount || 0} citations</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 0', fontSize: 13, marginTop: 16 }}
                disabled={comparisonSelection.length < 2}
                onClick={handleCompare}
              >
                Compare {comparisonSelection.length} Papers
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comparison Table Modal */}
      {renderShowComparison && (
        <div className="modal-overlay" onClick={() => setShowComparison(false)}>
          <div className="modal-panel brief-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/></svg>
                PAPER COMPARISON TABLE
              </div>
              <button className="modal-close" onClick={() => setShowComparison(false)}>&times;</button>
            </div>
            <div className="modal-body" style={{ overflowX: 'auto' }}>
              {renderComparisonLoading ? (
                <div className="modal-loading">
                  <div className="loading-spinner" />
                  <p>Generating comparison table...</p>
                </div>
              ) : renderComparisonData?.columns ? (
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th></th>
                      {renderComparisonData.columns.map((col, i) => (
                        <th key={i}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {renderComparisonData.rows?.map((row, i) => (
                      <tr key={i}>
                        <td className="comparison-category">{row.category}</td>
                        {row.values?.map((val, j) => (
                          <td key={j}>{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No comparison data available.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Clinical Trials Modal */}
      {renderShowTrials && (
        <div className="modal-overlay" onClick={() => setShowTrials(false)}>
          <div className="modal-panel brief-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
                ACTIVE CLINICAL TRIALS
              </div>
              <button className="modal-close" onClick={() => setShowTrials(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {renderTrialsLoading ? (
                <div className="modal-loading">
                  <div className="loading-spinner" />
                  <p>Searching ClinicalTrials.gov...</p>
                </div>
              ) : renderTrialsData?.length ? (
                <div className="trials-list">
                  {renderTrialsData.map((trial) => (
                    <div key={trial.nctId} className="trial-card">
                      <div className="trial-header">
                        <span className={`trial-status ${trial.status?.toLowerCase().replace(/\s+/g, '-')}`}>
                          {trial.status}
                        </span>
                        <span className="trial-phase">{trial.phase}</span>
                        <span className="trial-id">{trial.nctId}</span>
                      </div>
                      <h4 className="trial-title">{trial.title}</h4>
                      <div className="trial-meta">
                        {trial.enrollment > 0 && <span>{trial.enrollment} enrolled</span>}
                        {trial.sponsor && <span>{trial.sponsor}</span>}
                        {trial.startDate && <span>Started {trial.startDate}</span>}
                      </div>
                      {trial.conditions?.length > 0 && (
                        <div className="trial-tags">
                          {trial.conditions.map((c, i) => <span key={i} className="trial-tag condition">{c}</span>)}
                          {trial.interventions?.map((iv, i) => <span key={`iv-${i}`} className="trial-tag intervention">{iv}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
                  {renderTrialsMessage || 'No clinical trials found for this query.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Citation Chain Modal */}
      {showCitationChain && citationChainPaper && (
        <div className="modal-overlay" onClick={() => setShowCitationChain(false)}>
          <div className="modal-panel brief-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                CITATION CHAIN
              </div>
              <button className="modal-close" onClick={() => setShowCitationChain(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="citation-chain-source">
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: 1.5, marginBottom: 6 }}>SOURCE PAPER</div>
                <h4 style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{citationChainPaper.title}</h4>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{citationChainPaper.year} &middot; {citationChainPaper.citationCount || 0} citations</div>
              </div>

              {citationChainLoading ? (
                <div className="modal-loading">
                  <div className="loading-spinner" />
                  <p>Loading citation chain...</p>
                </div>
              ) : (
                <div className="citation-chain-sections">
                  <div className="citation-chain-section">
                    <div className="citation-chain-section-header">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
                      <span>Cited By ({citationChainData.citations.length})</span>
                    </div>
                    {citationChainData.citations.length === 0 ? (
                      <p className="citation-chain-empty">No citing papers found</p>
                    ) : (
                      citationChainData.citations.map((p) => (
                        <div key={p.paperId} className="citation-chain-item">
                          <div className="citation-chain-item-title">{p.title}</div>
                          <div className="citation-chain-item-meta">
                            {p.year} &middot; {p.citationCount || 0} citations
                            {p.authors?.slice(0, 2).map((a) => a.name).join(', ')}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="citation-chain-section">
                    <div className="citation-chain-section-header">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 21 3 21 3 15"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                      <span>References ({citationChainData.references.length})</span>
                    </div>
                    {citationChainData.references.length === 0 ? (
                      <p className="citation-chain-empty">No references found</p>
                    ) : (
                      citationChainData.references.map((p) => (
                        <div key={p.paperId} className="citation-chain-item">
                          <div className="citation-chain-item-title">{p.title}</div>
                          <div className="citation-chain-item-meta">
                            {p.year} &middot; {p.citationCount || 0} citations
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Session Modal */}
      {showSessionModal && (
        <div className="modal-overlay" onClick={() => { setShowSessionModal(false); setSessionError(''); }}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <div className="modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                COLLABORATIVE SESSIONS
              </div>
              <button className="modal-close" onClick={() => { setShowSessionModal(false); setSessionError(''); }}>&times;</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {session.isInSession ? (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Currently in session:</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{session.sessionName}</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-accent)', marginBottom: 16 }}>
                    Code: <span style={{ letterSpacing: '0.15em', fontWeight: 700 }}>{session.sessionId}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Members online:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {session.members.map((m, i) => (
                      <div key={i} className="session-member-chip">
                        <div className="session-member-dot" />
                        {m.name}
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{ background: 'var(--red-muted)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.2)' }}
                    onClick={() => { session.leaveRoom(); setShowSessionModal(false); }}
                  >
                    Leave Session
                  </button>
                </div>
              ) : (
                <>
                  {/* Create */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>CREATE NEW SESSION</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={sessionNameInput}
                        onChange={(e) => setSessionNameInput(e.target.value)}
                        placeholder="Session name (e.g. GLP-1 Review)"
                        style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={async () => {
                          try {
                            setSessionError('');
                            const data = await createSession(sessionNameInput || 'Research Session');
                            session.joinRoom(data.sessionId, data.name);
                            setSessionNameInput('');
                          } catch (err) { setSessionError(err.message); }
                        }}
                      >
                        Create
                      </button>
                    </div>
                  </div>

                  <div style={{ borderBottom: '1px solid var(--border)' }} />

                  {/* Join */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>JOIN WITH CODE</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={sessionInput}
                        onChange={(e) => setSessionInput(e.target.value)}
                        placeholder="Enter 6-character code"
                        maxLength={6}
                        style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', letterSpacing: '0.15em', fontFamily: 'var(--font-mono)' }}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={async () => {
                          try {
                            setSessionError('');
                            const data = await joinSession(sessionInput.trim());
                            session.joinRoom(data.sessionId, data.name);
                            setSessionInput('');
                          } catch (err) { setSessionError(err.message); }
                        }}
                        disabled={sessionInput.trim().length < 4}
                      >
                        Join
                      </button>
                    </div>
                  </div>

                  {sessionError && (
                    <div style={{ fontSize: 12, color: 'var(--red)', background: 'var(--red-muted)', padding: '8px 12px', borderRadius: 8 }}>{sessionError}</div>
                  )}

                  {/* Previous sessions */}
                  {sessionList.length > 0 && (
                    <div>
                      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 12 }} />
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>YOUR SESSIONS</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
                        {sessionList.map((s) => (
                          <button
                            key={s.id}
                            className="session-list-item"
                            onClick={async () => {
                              try {
                                await joinSession(s.id);
                                session.joinRoom(s.id, s.name);
                                setShowSessionModal(false);
                              } catch (err) { setSessionError(err.message); }
                            }}
                          >
                            <span>{s.name}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.id} · {s.member_count} members</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {sessionListLoading && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Loading sessions...</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Session ended popup */}
      {session.sessionEnded && (
        <div className="modal-overlay">
          <div className="modal-panel" style={{ maxWidth: 400, textAlign: 'center', padding: '32px 24px' }} onClick={(e) => e.stopPropagation()}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 16 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Session Ended</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
              The host has left the session. You can continue your own research independently.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => session.dismissSessionEnded()}
              style={{ padding: '8px 24px', fontSize: 13 }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Session presence bar — draggable */}
      {session.isInSession && (
        <div
          className="session-presence-bar"
          style={presencePos.x !== null ? {
            left: presencePos.x, top: presencePos.y,
            bottom: 'auto', transform: 'none',
          } : undefined}
          onMouseDown={(e) => {
            if (e.target.closest('button')) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setPressDrag({ offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top });
            const onMove = (ev) => {
              setPresencePos({
                x: Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - (e.clientX - rect.left))),
                y: Math.max(0, Math.min(window.innerHeight - rect.height, ev.clientY - (e.clientY - rect.top))),
              });
            };
            const onUp = () => {
              setPressDrag(null);
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
        >
          <div className="drag-handle" title="Drag to move">&#x2630;</div>
          <div className="session-live-dot" />
          <span className="session-presence-name">{session.sessionName}</span>
          <div className="session-presence-members">
            {session.members.map((m, i) => (
              <div key={i} className="session-avatar" title={m.name}>
                {m.name.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
          <button
            className="session-chat-toggle"
            onClick={() => setShowSessionChat((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
            {session.chatMessages.length > 0 && (
              <span className="session-chat-badge">{session.chatMessages.length}</span>
            )}
          </button>
        </div>
      )}

      {/* Session chat panel — draggable */}
      {session.isInSession && showSessionChat && (
        <div
          className="session-chat-panel"
          style={chatPos.x !== null ? {
            left: chatPos.x, top: chatPos.y,
            bottom: 'auto', right: 'auto',
          } : undefined}
        >
          <div
            className="session-chat-header"
            style={{ cursor: 'grab' }}
            onMouseDown={(e) => {
              const rect = e.currentTarget.parentElement.getBoundingClientRect();
              setChatDrag({ offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top });
              const onMove = (ev) => {
                setChatPos({
                  x: Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - (e.clientX - rect.left))),
                  y: Math.max(0, Math.min(window.innerHeight - rect.height, ev.clientY - (e.clientY - rect.top))),
                });
              };
              const onUp = () => {
                setChatDrag(null);
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          >
            <div className="drag-handle" title="Drag to move">&#x2630;</div>
            <span>Team Chat</span>
            <span className="session-chat-count">{session.members.length} online</span>
            <button className="session-chat-close" onClick={() => setShowSessionChat(false)}>&times;</button>
          </div>
          <div className="session-chat-messages" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
            {session.chatMessages.length === 0 && (
              <div className="session-chat-empty">No messages yet. Start the conversation!</div>
            )}
            {session.chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`session-chat-msg ${msg.userId === user.id ? 'own' : ''}`}
              >
                {msg.userId !== user.id && (
                  <div className="session-chat-msg-name">{msg.from}</div>
                )}
                <div className="session-chat-msg-text">{msg.text}</div>
                <div className="session-chat-msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
          <form
            className="session-chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (sessionChatInput.trim()) {
                session.sendChatMessage(sessionChatInput.trim());
                setSessionChatInput('');
              }
            }}
          >
            <input
              type="text"
              value={sessionChatInput}
              onChange={(e) => setSessionChatInput(e.target.value)}
              placeholder="Type a message..."
              className="session-chat-input"
            />
            <button type="submit" className="session-chat-send" disabled={!sessionChatInput.trim()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </form>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <SettingsPage
          user={user}
          onClose={() => setShowSettings(false)}
          onLogout={() => { setShowSettings(false); onLogout(); }}
          onDeleteAccount={handleDeleteAccount}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
      )}

      {/* Session notifications */}
      <div className="session-notifications">
        {session.notifications.map((n) => (
          <div key={n.id} className="session-notification">
            {n.text}
          </div>
        ))}
      </div>
    </div>
  );
}
