export default function PatternBanner({ suggestedTopics, onAccept, onDismiss }) {
  if (!suggestedTopics.length) return null;

  return (
    <div className="pattern-banner">
      {suggestedTopics.map((topic) => (
        <div key={topic} className="pattern-suggestion">
          <div className="pattern-pulse" />
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span className="pattern-text">
            Recurring topic detected: <strong>{topic}</strong>
          </span>
          <button className="pattern-accept" onClick={() => onAccept(topic)}>
            Open New Research Tab
          </button>
          <button className="pattern-dismiss" onClick={() => onDismiss(topic)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
