import { useState } from 'react';

const WORKFLOW_STEPS = [
  {
    num: '01',
    title: 'Describe',
    desc: 'Enter a patient case in natural language — symptoms, history, lab values, anything relevant.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'Discover',
    desc: 'AI extracts clinical concepts and searches 200M+ papers on Semantic Scholar, building a knowledge graph.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Read',
    desc: 'AI highlights key findings, methods, and limitations. Listen to highlights read aloud. Rank papers by relevance.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    num: '04',
    title: 'Ask',
    desc: 'Chat with an AI agent scoped to each paper. It detects patterns in your questions and suggests new research threads.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export default function ClinicalInput({ onSubmit, isLoading }) {
  const [description, setDescription] = useState('');
  const [focused, setFocused] = useState(false);

  const examples = [
    {
      label: 'Cardiology',
      text: 'Patient 45M, chest pain, elevated troponin, STEMI ruled out. Atypical presentation. Not responding to standard protocol.',
    },
    {
      label: 'Neurology',
      text: 'Female 32, recurring migraines with aura, unresponsive to triptans, family history of stroke.',
    },
    {
      label: 'Pulmonology',
      text: 'Pediatric patient 8yo, persistent cough 6 weeks, normal chest X-ray, elevated eosinophils.',
    },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (description.trim() && !isLoading) {
      onSubmit(description.trim());
    }
  };

  return (
    <div className="clinical-input">
      <div className="input-hero">
        <div className="hero-badge">AI-Powered Clinical Research</div>
        <h1>
          From patient description
          <br />
          to <span className="gradient-text">research intelligence</span>
        </h1>
        <p className="hero-sub">
          ATLAS transforms a clinical problem into a living research workspace —
          knowledge graphs, ranked papers with AI highlights, and an agent that
          learns your diagnostic focus.
        </p>
      </div>

      <form onSubmit={handleSubmit} className={focused ? 'focused' : ''}>
        <div className="textarea-wrap">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Describe the clinical problem...  e.g., Patient 45M, chest pain, elevated troponin, STEMI ruled out."
            rows={4}
            disabled={isLoading}
          />
          <div className="textarea-glow" />
        </div>
        <button type="submit" className="submit-btn" disabled={!description.trim() || isLoading}>
          {isLoading ? (
            <span className="btn-loading">
              <span className="btn-spinner" />
              Analyzing...
            </span>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Search Research Literature
            </>
          )}
        </button>
      </form>

      {/* How It Works */}
      <div className="workflow-section">
        <h2 className="workflow-heading">How ATLAS Works</h2>
        <div className="workflow-grid">
          {WORKFLOW_STEPS.map((step) => (
            <div key={step.num} className="workflow-card">
              <div className="workflow-icon">{step.icon}</div>
              <div className="workflow-num">{step.num}</div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Example cases */}
      <div className="examples-section">
        <span className="examples-label">Try an example case</span>
        <div className="examples-grid">
          {examples.map((ex, i) => (
            <button
              key={i}
              className="example-card"
              onClick={() => setDescription(ex.text)}
              disabled={isLoading}
            >
              <span className="example-specialty">{ex.label}</span>
              <span className="example-text">{ex.text}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="powered-by">
        <span>Powered by</span>
        <span className="powered-logos">Gemini AI + Semantic Scholar</span>
        <span className="powered-sep">|</span>
        <span>200M+ research papers</span>
      </div>
    </div>
  );
}
