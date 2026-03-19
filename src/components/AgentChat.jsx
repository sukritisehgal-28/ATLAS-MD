import { useState, useRef, useEffect } from 'react';
import { chatWithAgent } from '../services/api';

const QUICK_QUESTIONS = [
  { icon: '01', text: 'What are the key clinical implications?' },
  { icon: '02', text: 'How does this compare to current guidelines?' },
  { icon: '03', text: 'What are the main limitations?' },
  { icon: '04', text: 'Is this applicable to my patient?' },
];

export default function AgentChat({ paper, highlights, onQuestion }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const prevPaperIdRef = useRef(null);

  useEffect(() => {
    if (paper?.paperId !== prevPaperIdRef.current) {
      setMessages([]);
      prevPaperIdRef.current = paper?.paperId;
    }
  }, [paper?.paperId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text) => {
    if (!text.trim() || !paper || loading) return;
    const userMsg = { role: 'user', content: text.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    if (onQuestion) onQuestion(text.trim());

    try {
      const data = await chatWithAgent(updatedMessages, paper, highlights || []);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}. Please try again.` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  if (!paper) {
    return (
      <div className="agent-chat greeting">
        <div className="greeting-bubble">
          <div className="greeting-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" /><path d="M12 16v-4" /><path d="M12 8h.01" />
            </svg>
          </div>
          <div className="greeting-content">
            <div className="greeting-text">
              <strong>Hey, I'm your research assistant!</strong>
              <p>Click a node in the graph or select a paper from the rankings — I'll help you analyze it.</p>
            </div>
            <div className="greeting-tail" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" /><path d="M12 16v-4" /><path d="M12 8h.01" />
            </svg>
          </div>
          <div>
            <h4>Research Assistant</h4>
            <span className="chat-scope">{paper.title.slice(0, 45)}...</span>
          </div>
        </div>
        <span className={`chat-status ${loading ? 'thinking' : 'ready'}`}>
          {loading ? 'Thinking...' : 'Ready'}
        </span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p>Ask me anything about this paper:</p>
            <div className="quick-questions">
              {QUICK_QUESTIONS.map((q, i) => (
                <button key={i} className="quick-q-btn" onClick={() => sendMessage(q.text)}>
                  <span className="qq-num">{q.icon}</span>
                  <span>{q.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? 'You' : 'AI'}
            </div>
            <div className="message-bubble">
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-message assistant">
            <div className="message-avatar">AI</div>
            <div className="message-bubble typing">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this paper..."
          disabled={loading}
        />
        <button type="submit" disabled={!input.trim() || loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
