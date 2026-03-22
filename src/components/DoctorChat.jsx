import { useState, useRef, useEffect } from 'react';
import { doctorChat, doctorChatWeb, extractResearchQuery, getFollowUpQuestions } from '../services/api';

const SUGGESTIONS = [
  { text: 'Search papers on GLP-1 agonists for obesity', research: true },
  { text: 'Find research comparing SSRIs vs SNRIs', research: true },
  { text: 'Search studies on BRCA mutations and targeted therapy', research: true },
  { text: 'Find papers on new heart failure management guidelines', research: true },
];

const LOADING_MESSAGES = [
  'Scrubbing in... preparing your diagnosis',
  'Checking the patient\'s chart...',
  'Consulting the medical literature...',
  'Running differential diagnosis...',
  'Paging the attending physician...',
  'Cross-referencing clinical guidelines...',
  'Reviewing lab results...',
  'Checking vital signs of the evidence...',
];

export default function DoctorChat({ onSwitchToResearch }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [followUpQuestions, setFollowUpQuestions] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll when messages change or loading state changes
  useEffect(() => {
    // Use setTimeout to ensure DOM has updated before scrolling
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, loading, loadingMsgIndex]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Rotate loading messages every 2 seconds while loading
  useEffect(() => {
    if (!loading) {
      setLoadingMsgIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingMsgIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [loading]);

  // Detect if user wants to search for research papers
  const detectResearchIntent = (text) => {
    const lower = text.toLowerCase();
    const patterns = [
      /find\s+(research\s+)?papers?\s*(on|about|for|regarding)?/,
      /search\s+(for\s+)?(research\s+)?papers?\s*(on|about|for|regarding)?/,
      /can you find\s+(research|papers?|studies)/,
      /look\s+(up|for)\s+(research|papers?|studies)/,
      /get\s+me\s+(research|papers?|studies)/,
      /show\s+me\s+(research|papers?|studies)/,
      /fetch\s+(research|papers?|studies)/,
      /research\s+papers?\s*(on|about|for|regarding)?/,
      /find\s+(me\s+)?(some\s+)?(studies|articles|literature)/,
      /any\s+(research|papers?|studies)\s+(on|about)/,
      /what\s+(does\s+the\s+)?research\s+say\s+(about|on)/,
      /search\s+(the\s+)?literature\s+(on|about|for)/,
      /give\s+(me\s+)?(some\s+)?(research|papers?|studies|articles)/,
      /i\s+(want|need)\s+(research|papers?|studies)/,
      /papers?\s+(on|about|for|regarding)\s+/,
      /pull\s+(up\s+)?(research|papers?|studies)/,
    ];
    return patterns.some((p) => p.test(lower));
  };

  // Extract the research topic from the message
  const extractResearchTopic = (text) => {
    const lower = text.toLowerCase();
    // Remove common prefixes to get the topic
    const cleaned = lower
      .replace(/^(can you |please |could you |i want to |i need to |i'd like to )/i, '')
      .replace(/^(find|search|look up|get me|show me|fetch|look for|give me|give|pull up)\s+(me\s+)?(some\s+)?(research\s+)?(papers?|studies|articles|literature)\s*(on|about|for|regarding)?\s*/i, '')
      .replace(/^(i\s+(want|need)\s+)(research\s+)?(papers?|studies)\s*(on|about|for|regarding)?\s*/i, '')
      .replace(/^(any|what does the|what does)\s+(research\s+)?(papers?|studies)?\s*(say\s+)?(on|about)\s+/i, '')
      .replace(/^(research\s+papers?\s*(on|about|for|regarding)\s*)/i, '')
      .replace(/^(papers?\s+(on|about|for|regarding)\s+)/i, '')
      .replace(/^(search\s+(the\s+)?literature\s+(on|about|for)\s+)/i, '')
      .replace(/[?.!]+$/, '')
      .trim();
    return cleaned || text.trim();
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    const trimmed = text.trim();

    // Check for research intent — use conversation memory to extract query
    if (detectResearchIntent(trimmed)) {
      const allMessages = [...messages, { role: 'user', content: trimmed }];
      setMessages(allMessages);
      setInput('');
      setLoading(true);
      setFollowUpQuestions([]);

      try {
        // Use Gemini to extract a research query from the full conversation
        const data = await extractResearchQuery(allMessages);
        const query = data.query || extractResearchTopic(trimmed);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Found it! Searching research papers for "${query}"...` },
        ]);
        setLoading(false);
        setTimeout(() => onSwitchToResearch?.(query), 600);
      } catch {
        // Fallback to simple extraction
        const fallback = extractResearchTopic(trimmed);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Redirecting to research for "${fallback}"...` },
        ]);
        setLoading(false);
        setTimeout(() => onSwitchToResearch?.(fallback), 600);
      }
      return;
    }

    const userMsg = { role: 'user', content: trimmed };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const chatFn = webSearch ? doctorChatWeb : doctorChat;
      const data = await chatFn(updated);
      const newMessages = [...updated, { role: 'assistant', content: data.reply }];
      setMessages(newMessages);
      // Fetch follow-up questions in the background
      setFollowUpQuestions([]);
      getFollowUpQuestions(newMessages)
        .then((fData) => setFollowUpQuestions(fData.questions || []))
        .catch(() => setFollowUpQuestions([]));
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const formatMessage = (text) => {
    // Strip markdown formatting first
    const cleaned = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,4}\s+/gm, '');

    return cleaned.split('\n').map((line, i) => {
      // Bullet points
      if (line.match(/^[-•]\s/)) {
        return <li key={i}>{line.replace(/^[-•]\s/, '')}</li>;
      }
      // Numbered lists
      if (line.match(/^\d+\.\s/)) {
        return <li key={i}>{line.replace(/^\d+\.\s/, '')}</li>;
      }
      return <span key={i}>{line}{'\n'}</span>;
    });
  };

  return (
    <div className="doctor-chat-page">
      {/* Messages area */}
      <div className="dc-messages-area">
        {messages.length === 0 ? (
          <div className="dc-welcome">
            <div className="dc-welcome-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <h1>How can I help you today?</h1>
            <p className="dc-welcome-sub">
              Ask me anything about clinical research, treatments, diagnostics, or medical literature.
            </p>
            <div className="dc-suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  className="dc-suggestion-card"
                  onClick={() => s.research ? onSwitchToResearch?.(extractResearchTopic(s.text)) : sendMessage(s.text)}
                >
                  <span className="dc-suggestion-text">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="dc-conversation">
            {messages.map((msg, i) => (
              <div key={i} className={`dc-msg ${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="dc-msg-avatar">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                  </div>
                )}
                <div className="dc-msg-content">
                  <div className="dc-msg-text" style={{ whiteSpace: 'pre-wrap' }}>
                    {formatMessage(msg.content)}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="dc-msg assistant">
                <div className="dc-msg-avatar">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <div className="dc-msg-content">
                  <div className="dc-loading-message">
                    <svg className="dc-loading-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    <span className="dc-loading-text">{LOADING_MESSAGES[loadingMsgIndex]}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Smart Follow-up Questions */}
            {!loading && followUpQuestions.length > 0 && (
              <div className="dc-followup-questions">
                <div className="dc-followup-label">Follow-up questions</div>
                <div className="dc-followup-list">
                  {followUpQuestions.map((q, i) => (
                    <button
                      key={i}
                      className="dc-followup-btn"
                      onClick={() => { setFollowUpQuestions([]); sendMessage(q); }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="dc-input-wrap">
        <div className="dc-input-container">
          <form onSubmit={handleSubmit} className="dc-input-form">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask ATLAS anything..."
              rows={1}
              disabled={loading}
              className="dc-textarea"
            />
            <div className="dc-input-actions">
              <button
                type="button"
                className={`dc-web-search-btn${webSearch ? ' active' : ''}`}
                onClick={() => setWebSearch((prev) => !prev)}
                title={webSearch ? 'Web search enabled' : 'Enable web search'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span>Web</span>
              </button>
              <button
                type="button"
                className="dc-research-btn"
                onClick={() => onSwitchToResearch?.(input || undefined)}
                title="Deep research mode"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span>Research</span>
              </button>
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="dc-send-btn"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </div>
          </form>
          <p className="dc-disclaimer">
            ATLAS AI may make mistakes. Always verify clinical decisions with primary sources.
          </p>
        </div>
      </div>
    </div>
  );
}
