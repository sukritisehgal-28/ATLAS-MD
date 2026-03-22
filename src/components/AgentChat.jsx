import { useState, useRef, useEffect, useCallback } from 'react';
import { chatWithAgent, doctorChat } from '../services/api';

const QUICK_QUESTIONS = [
  'What are the key clinical findings?',
  'What are the limitations?',
  'How does this compare to guidelines?',
  'Who does this study apply to?',
];

// Extract repeated meaningful words from messages
function detectRepeatedTopics(messages) {
  const stopWords = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','shall','can',
    'to','of','in','for','on','with','at','by','from','as','into','about','between',
    'through','during','before','after','above','below','this','that','these','those',
    'it','its','i','you','he','she','we','they','me','him','her','us','them','my',
    'your','his','our','their','what','which','who','whom','how','when','where','why',
    'and','but','or','nor','not','no','so','if','than','too','very','just','also',
    'more','most','other','some','any','all','each','every','both','few','many',
    'much','own','same','such','only','paper','study','research','studies','results',
  ]);

  const wordCount = {};
  messages.forEach((m) => {
    if (m.role !== 'user') return;
    const words = m.content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    words.forEach((w) => {
      if (!stopWords.has(w)) wordCount[w] = (wordCount[w] || 0) + 1;
    });
  });

  // Find words that appear 3+ times across user messages
  const repeated = Object.entries(wordCount)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  return repeated.length > 0 ? repeated[0] : null;
}

export default function AgentChat({ paper, highlights, onQuestion, onNewTab, sessionNotes = [], onAddNote, allPapers = [], agentMessages: externalMessages, onAgentMessagesChange, agentOpen: externalOpen, onAgentOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setIsOpen = onAgentOpenChange || setInternalOpen;
  const [isExpanded, setIsExpanded] = useState(false);
  const [internalMessages, setInternalMessages] = useState([]);
  const messages = externalMessages !== undefined ? externalMessages : internalMessages;
  const setMessages = onAgentMessagesChange
    ? (updater) => {
        if (typeof updater === 'function') {
          // Pass the function updater directly to the state setter
          // to avoid stale closure issues with `messages`
          onAgentMessagesChange((prev) => updater(prev));
        } else {
          onAgentMessagesChange(updater);
        }
      }
    : setInternalMessages;
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [floatingBubbles, setFloatingBubbles] = useState([]);
  const [showGreeting, setShowGreeting] = useState(true);
  const [topicSuggestion, setTopicSuggestion] = useState(null);
  const [proactiveLoading, setProactiveLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const prevPaperIdRef = useRef(null);
  const timersRef = useRef([]);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Reset on paper change
  useEffect(() => {
    if (paper?.paperId !== prevPaperIdRef.current) {
      setMessages([]);
      setFloatingBubbles([]);
      setShowGreeting(true);
      setTopicSuggestion(null);
      prevPaperIdRef.current = paper?.paperId;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];

      if (paper) {
        generateProactiveQuestions(paper);
      }
    }
  }, [paper?.paperId]);

  // Detect repeated words in conversation
  useEffect(() => {
    const userMessages = messages.filter((m) => m.role === 'user');
    if (userMessages.length >= 2) {
      const topic = detectRepeatedTopics(messages);
      if (topic && topic !== topicSuggestion) {
        setTopicSuggestion(topic);
      }
    }
  }, [messages]);

  // When panel opens, clear unread and greeting
  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
      setShowGreeting(false);
    }
  }, [isOpen]);

  const generateProactiveQuestions = useCallback(async (p) => {
    setProactiveLoading(true);
    try {
      const data = await doctorChat([{
        role: 'user',
        content: `Generate exactly 3 proactive questions while a user reads this paper. Make them think deeper. Point out limitations or surprising findings.\nPaper: ${p.title} (${p.year})\nAbstract: ${p.abstract?.slice(0, 400)}\n\nReturn ONLY a JSON array: ["q1","q2","q3"]\nEach max 20 words. Conversational.`,
      }]);
      setProactiveLoading(false);
      const questions = JSON.parse(data.reply.replace(/```json|```/g, '').trim());
      if (Array.isArray(questions)) {
        const delays = [8000, 25000, 45000];
        questions.forEach((q, i) => {
          const timer = setTimeout(() => {
            const bubble = { id: Date.now() + i, content: q };
            // Replace previous bubble — only show one at a time
            // Also hide the greeting when first question appears
            setShowGreeting(false);
            setFloatingBubbles([bubble]);
            if (!isOpen) setHasUnread(true);
          }, delays[i]);
          timersRef.current.push(timer);
        });
      }
    } catch {
      setProactiveLoading(false);
      // Silently fail proactive generation
    }
  }, [isOpen]);

  const dismissBubble = (id) => {
    setFloatingBubbles((prev) => prev.filter((b) => b.id !== id));
  };

  // Click a floating bubble → open panel, autofill textarea
  const handleBubbleClick = (bubble) => {
    setIsOpen(true);
    setInput(bubble.content);
    dismissBubble(bubble.id);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Detect if user message is asking for papers/research
  const detectSearchIntent = (text) => {
    const lower = text.toLowerCase();
    const searchPhrases = [
      /(?:find|get|search|look\s*up|fetch|provide|give|show|pull\s*up|bring)\s+(?:me\s+)?(?:some\s+)?(?:research\s+)?papers?\b/,
      /(?:find|get|search|look\s*up|fetch|provide|give|show|pull\s*up|bring)\s+(?:me\s+)?(?:some\s+)?(?:research|studies|articles|literature)\b/,
      /(?:papers?|research|studies|articles|literature)\s+(?:on|about|regarding|related\s+to|for)\b/,
      /(?:search|look)\s+(?:for|up)\b.*(?:papers?|research|studies|articles)/,
      /(?:i\s+(?:want|need)|can\s+you\s+(?:find|get))\s+.*(?:papers?|research|studies|articles)/,
      /(?:any|more)\s+(?:papers?|research|studies|articles)\s+(?:on|about)/,
    ];
    return searchPhrases.some((re) => re.test(lower));
  };

  // Extract the topic from a search-intent message
  const extractSearchTopic = (text) => {
    const lower = text.toLowerCase();
    // Try to extract topic after common prepositions
    const topicMatch = lower.match(/(?:on|about|regarding|related\s+to|for)\s+(.+?)(?:\?|$|\.)/);
    if (topicMatch) return topicMatch[1].trim();
    // Try to extract after "papers/research/studies"
    const afterMatch = lower.match(/(?:papers?|research|studies|articles|literature)\s+(.+?)(?:\?|$|\.)/);
    if (afterMatch) return afterMatch[1].trim();
    // Fallback: remove the action words and return the rest
    return text.replace(/(?:find|get|search|look\s*up|fetch|provide|give|show|pull\s*up|bring)\s+(?:me\s+)?(?:some\s+)?(?:research\s+)?(?:papers?|research|studies|articles|literature)\s*/i, '').replace(/[?.!]$/, '').trim();
  };

  const sendMessage = async () => {
    if (!input.trim() || !paper || loading) return;
    const text = input.trim();
    const userMsg = { role: 'user', content: text };
    const updated = [...messages.filter((m) => !m.isProactive), userMsg];
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    if (onQuestion) onQuestion(text);

    // Check if user is asking for papers — detect on user side as a fallback
    const userWantsPapers = detectSearchIntent(text);
    const userSearchTopic = userWantsPapers ? extractSearchTopic(text) : null;

    try {
      const data = await chatWithAgent(
        updated.map((m) => ({ role: m.role, content: m.content })),
        paper,
        highlights || [],
        allPapers
      );
      // Strip markdown formatting (bold, italic, headers) from the reply
      let displayReply = data.reply
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/^#{1,4}\s+/gm, '')
        .replace(/^[\*\-]\s+/gm, '- ');
      let searchTriggered = false;
      const searchMatch = data.reply.match(/\[SEARCH:\s*(.+?)\]/);
      if (searchMatch && onNewTab) {
        displayReply = data.reply.replace(/\[SEARCH:\s*.+?\]/, '').trim();
        setTimeout(() => onNewTab(searchMatch[1]), 800);
        searchTriggered = true;
      }

      // Fallback: if user asked for papers but AI didn't include [SEARCH:], trigger it anyway
      if (!searchTriggered && userWantsPapers && userSearchTopic && onNewTab) {
        setTimeout(() => onNewTab(userSearchTopic), 800);
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: displayReply }]);

      // Extract key finding for session notes
      if (onAddNote && data.reply && !data.reply.startsWith('Error') && data.reply !== 'Thinking...') {
        const firstSentenceMatch = data.reply.match(/^[^.!?\n]+[.!?]?/);
        if (firstSentenceMatch) {
          const finding = firstSentenceMatch[0].slice(0, 100).trim();
          if (finding.length > 0) {
            onAddNote(finding);
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const DoctorIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );

  // Dot (collapsed) — RIGHT SIDE
  if (!isOpen) {
    return (
      <div className="agent-float-right">
        {/* Thinking indicator while generating proactive questions */}
        {proactiveLoading && floatingBubbles.length === 0 && !showGreeting && (
          <div className="agent-greeting-bubble" onClick={() => setIsOpen(true)}>
            <div className="agent-floating-bubble-label">ATLAS</div>
            <div className="agent-floating-bubble-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="agent-thinking-dots">
                <span /><span /><span />
              </span>
              Analyzing paper...
            </div>
          </div>
        )}

        {/* Greeting bubble — same style as question bubbles */}
        {showGreeting && floatingBubbles.length === 0 && !proactiveLoading && (
          <div className="agent-greeting-bubble" onClick={() => setIsOpen(true)}>
            <div className="agent-floating-bubble-label">ATLAS</div>
            <div className="agent-floating-bubble-text">Hey, I'm your research agent! Click to chat</div>
          </div>
        )}

        {/* Floating proactive question bubbles — click to autofill */}
        {floatingBubbles.map((bubble) => (
          <div
            key={bubble.id}
            className="agent-floating-bubble"
            onClick={() => handleBubbleClick(bubble)}
          >
            <div className="agent-floating-bubble-label">ATLAS</div>
            <div className="agent-floating-bubble-text">{bubble.content}</div>
            <button className="agent-floating-bubble-close" onClick={(e) => { e.stopPropagation(); dismissBubble(bubble.id); }}>&times;</button>
          </div>
        ))}

        {/* The dot with doctor icon */}
        <div className="agent-dot" onClick={() => setIsOpen(true)}>
          <DoctorIcon />
          {hasUnread && <div className="agent-dot-notification" />}
        </div>
      </div>
    );
  }

  // Panel (expanded) — RIGHT SIDE
  return (
    <div className={`agent-panel slider ${isExpanded ? 'agent-panel-expanded' : ''}`}>
      {/* Header */}
      <div className="agent-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="agent-panel-icon">
            <DoctorIcon />
          </div>
          <div>
            <div className="agent-panel-title">ATLAS AGENT</div>
            <div className="agent-panel-scope">
              {paper ? `Analyzing: ${paper.title?.slice(0, 35)}...` : 'No paper selected'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="agent-panel-status" />
          <button
            className="agent-panel-expand"
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
            )}
          </button>
          <button className="agent-panel-close" onClick={() => { setIsOpen(false); setIsExpanded(false); }}>&times;</button>
        </div>
      </div>

      {/* Messages */}
      <div className="agent-messages">
        {/* Session Notes */}
        {sessionNotes.length > 0 && (
          <div style={{ padding: '8px 12px', marginBottom: 6 }}>
            <div style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}>
              ◈ SESSION NOTES
            </div>
            <ul style={{
              margin: 0,
              paddingLeft: 16,
              fontSize: 11,
              color: 'var(--text-secondary, #aaa)',
              lineHeight: 1.6,
              listStyleType: 'disc',
            }}>
              {sessionNotes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
            <div style={{
              borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
              marginTop: 8,
            }} />
          </div>
        )}

        {/* Quick question chips */}
        {messages.length === 0 && paper && (
          <div className="agent-chips">
            {QUICK_QUESTIONS.map((q, i) => (
              <button key={i} className="agent-chip" onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}>
                {q}
              </button>
            ))}
          </div>
        )}

        {!paper && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
            Select a paper from the graph to start
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.isProactive) {
            return (
              <div key={i} className="proactive-bubble" onClick={() => { setInput(msg.content); setTimeout(() => inputRef.current?.focus(), 50); }}>
                <div className="proactive-label">ATLAS</div>
                <div className="proactive-text">{msg.content}</div>
              </div>
            );
          }

          return (
            <div key={i} className={`agent-msg ${msg.role}`}>
              <div className="agent-msg-bubble">
                {msg.role === 'assistant' && (
                  <span className="agent-msg-icon"><DoctorIcon /></span>
                )}
                <span>{msg.content}</span>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="agent-msg assistant">
            <div className="agent-msg-bubble">
              <span className="agent-msg-icon"><DoctorIcon /></span>
              <span style={{ opacity: 0.7, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="agent-thinking-dots"><span /><span /><span /></span>
                Thinking...
              </span>
            </div>
          </div>
        )}

        {/* Topic suggestion popup */}
        {topicSuggestion && (
          <div className="agent-topic-suggest">
            <div className="agent-topic-suggest-text">
              You keep mentioning <strong>"{topicSuggestion}"</strong>. Want me to fetch research papers on this topic?
            </div>
            <div className="agent-topic-suggest-actions">
              <button className="btn btn-sm btn-primary" onClick={() => { onNewTab?.(topicSuggestion); setTopicSuggestion(null); }}>
                Yes, search
              </button>
              <button className="btn btn-sm" onClick={() => setTopicSuggestion(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="agent-input-area">
        <div className="agent-input-form">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this paper..."
            disabled={!paper || loading}
          />
          <button
            className="agent-send-btn"
            onClick={sendMessage}
            disabled={!input.trim() || loading || !paper}
          >
            &uarr;
          </button>
        </div>
      </div>
    </div>
  );
}
