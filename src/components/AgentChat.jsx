import { useState, useRef, useEffect, useCallback } from 'react';
import { chatWithAgent } from '../services/api';

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

export default function AgentChat({ paper, highlights, onQuestion, onNewTab }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [floatingBubbles, setFloatingBubbles] = useState([]);
  const [showGreeting, setShowGreeting] = useState(true);
  const [topicSuggestion, setTopicSuggestion] = useState(null);
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
    try {
      const res = await fetch('http://localhost:3001/api/doctor-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Generate exactly 3 proactive questions while a user reads this paper. Make them think deeper. Point out limitations or surprising findings.\nPaper: ${p.title} (${p.year})\nAbstract: ${p.abstract?.slice(0, 400)}\n\nReturn ONLY a JSON array: ["q1","q2","q3"]\nEach max 20 words. Conversational.`,
          }],
        }),
      });
      const data = await res.json();
      const questions = JSON.parse(data.reply.replace(/```json|```/g, '').trim());
      if (Array.isArray(questions)) {
        const delays = [5000, 22000, 38000];
        questions.forEach((q, i) => {
          const timer = setTimeout(() => {
            const bubble = { id: Date.now() + i, content: q };
            setFloatingBubbles((prev) => [...prev, bubble]);
            if (!isOpen) setHasUnread(true);
          }, delays[i]);
          timersRef.current.push(timer);
        });
      }
    } catch {
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

  const sendMessage = async () => {
    if (!input.trim() || !paper || loading) return;
    const text = input.trim();
    const userMsg = { role: 'user', content: text };
    const updated = [...messages.filter((m) => !m.isProactive), userMsg];
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    if (onQuestion) onQuestion(text);

    try {
      const data = await chatWithAgent(
        updated.map((m) => ({ role: m.role, content: m.content })),
        paper,
        highlights || []
      );
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
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
        {/* Greeting bubble */}
        {showGreeting && (
          <div className="agent-greeting-bubble">
            Hey, I'm your agent! Click to use me
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
    <div className="agent-panel slider">
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
          <button className="agent-panel-close" onClick={() => setIsOpen(false)}>&times;</button>
        </div>
      </div>

      {/* Messages */}
      <div className="agent-messages">
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
              <span style={{ opacity: 0.5 }}>Thinking...</span>
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
              <button className="btn btn-sm btn-primary" onClick={() => { onNewTab(topicSuggestion); setTopicSuggestion(null); }}>
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
