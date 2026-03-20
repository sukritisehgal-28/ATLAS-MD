import { useState, useRef, useEffect } from 'react';
import { doctorChat } from '../services/api';

const SUGGESTIONS = [
  { icon: '🔬', text: 'Search papers on GLP-1 agonists for obesity', research: true },
  { icon: '💊', text: 'Find research comparing SSRIs vs SNRIs', research: true },
  { icon: '🧬', text: 'Search studies on BRCA mutations and targeted therapy', research: true },
  { icon: '🫀', text: 'Find papers on new heart failure management guidelines', research: true },
];

export default function DoctorChat({ onSwitchToResearch }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Detect if user wants to search for research papers
  const detectResearchIntent = (text) => {
    const lower = text.toLowerCase();
    const patterns = [
      /find\s+(research\s+)?papers?\s+(on|about|for|regarding)/,
      /search\s+(for\s+)?(research\s+)?papers?\s*(on|about|for|regarding)?/,
      /can you find\s+(research|papers?|studies)/,
      /look\s+(up|for)\s+(research|papers?|studies)/,
      /get\s+me\s+(research|papers?|studies)/,
      /show\s+me\s+(research|papers?|studies)/,
      /fetch\s+(research|papers?|studies)/,
      /research\s+papers?\s+(on|about|for|regarding)/,
      /find\s+(me\s+)?(some\s+)?(studies|articles|literature)\s+(on|about)/,
      /any\s+(research|papers?|studies)\s+(on|about)/,
      /what\s+(does\s+the\s+)?research\s+say\s+(about|on)/,
      /search\s+(the\s+)?literature\s+(on|about|for)/,
    ];
    return patterns.some((p) => p.test(lower));
  };

  // Extract the research topic from the message
  const extractResearchTopic = (text) => {
    const lower = text.toLowerCase();
    // Remove common prefixes to get the topic
    const cleaned = lower
      .replace(/^(can you |please |could you |i want to |i need to |i'd like to )/i, '')
      .replace(/^(find|search|look up|get me|show me|fetch|look for)\s+(me\s+)?(some\s+)?(research\s+)?(papers?|studies|articles|literature)\s+(on|about|for|regarding)\s+/i, '')
      .replace(/^(any|what does the|what does)\s+(research\s+)?(papers?|studies)?\s*(say\s+)?(on|about)\s+/i, '')
      .replace(/^(research\s+papers?\s+(on|about|for|regarding)\s+)/i, '')
      .replace(/^(search\s+(the\s+)?literature\s+(on|about|for)\s+)/i, '')
      .replace(/[?.!]+$/, '')
      .trim();
    return cleaned || text.trim();
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    const trimmed = text.trim();

    // Check for research intent — redirect to research section
    if (detectResearchIntent(trimmed)) {
      const topic = extractResearchTopic(trimmed);
      // Show a brief message before redirecting
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: `Redirecting you to the research section to search papers on "${topic}"...` },
      ]);
      setInput('');
      setTimeout(() => onSwitchToResearch?.(topic), 800);
      return;
    }

    const userMsg = { role: 'user', content: trimmed };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const data = await doctorChat(updated);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
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
    // Simple markdown-like formatting
    return text.split('\n').map((line, i) => {
      // Bold
      line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Bullet points
      if (line.match(/^[-•]\s/)) {
        return `<li key="${i}">${line.replace(/^[-•]\s/, '')}</li>`;
      }
      // Numbered lists
      if (line.match(/^\d+\.\s/)) {
        return `<li key="${i}">${line.replace(/^\d+\.\s/, '')}</li>`;
      }
      return line;
    }).join('\n');
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
                  onClick={() => s.research ? onSwitchToResearch?.(s.text) : sendMessage(s.text)}
                >
                  <span className="dc-suggestion-icon">{s.icon}</span>
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
                  <div
                    className="dc-msg-text"
                    dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
                  />
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
                  <div className="dc-typing">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
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
