<p align="center">
  <h1 align="center">ATLAS-MD</h1>
  <p align="center">AI-Powered Clinical Research Intelligence Platform</p>
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#api-reference">API Reference</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

ATLAS-MD helps doctors and researchers navigate medical literature faster. Search a clinical question, and ATLAS builds a knowledge graph of relevant papers, analyzes relationships between studies, identifies contradictions, and lets you chat with an AI research agent about your findings.

## Features

### Knowledge Graph
- Search any clinical topic and visualize papers as an interactive force-directed graph
- Nodes sized by recency (newer papers = larger), colored by relationship type
- Timeline mode to see research evolution over time
- Conflict mode to highlight contradictions between studies

### AI Research Agent
- Proactive research companion that asks thought-provoking questions as you read
- Context-aware: knows the paper you're reading + all papers in your session
- Ask it to find papers on a topic and it automatically opens a new search tab
- Detects when you keep mentioning a topic and offers to search for it

### Paper Reader
- Full paper analysis with AI-generated highlights (key findings, methodology, limitations)
- Text-to-speech for hands-free reading
- Evidence strength scoring (systematic review through expert opinion)

### AI Doctor Chat
- General medical research chat with optional web search grounding
- Conversational, not robotic — talks like a knowledgeable colleague
- Smart follow-up question suggestions

### Research Tools
- **Reading Lists** — AI-curated personalized reading order based on your experience level and specialty
- **Clinical Briefs** — Auto-generated research summaries across all papers
- **Paper Comparison** — Side-by-side comparison tables
- **Clinical Trials** — Search ClinicalTrials.gov directly from your research session
- **Citation Chains** — Explore citation and reference networks
- **Bookmarks** — Save papers per-user for later

### Authentication
- Email/password authentication with JWT
- Per-user bookmarks and sessions
- SQLite database (zero-config, no external DB needed)

## Quick Start

### Prerequisites

- **Node.js** 18+ (for `AbortSignal.timeout` support)
- **npm** 9+

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/ATLAS-MD.git
cd ATLAS-MD
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

| Variable | Required | Where to get it |
|----------|----------|----------------|
| `Gemini_API_KEY` | Yes | [Google AI Studio](https://aistudio.google.com/apikey) |
| `SEMANTIC_SCHOLAR_API_KEY` | Yes | [Semantic Scholar](https://www.semanticscholar.org/product/api#api-key-form) |
| `JWT_SECRET` | Yes | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CLAUDE_API_KEY` | No | [Anthropic Console](https://console.anthropic.com/) |

### 4. Start the app

```bash
npm start
```

This runs both the backend (port 3001) and frontend (port 5173) concurrently.

Open [http://localhost:5173](http://localhost:5173), create an account, and start researching.

## Architecture

```
ATLAS-MD/
├── server/
│   ├── index.js          # Express API server (18 endpoints)
│   ├── auth.js           # JWT authentication + middleware
│   └── db.js             # SQLite database initialization
├── src/
│   ├── components/
│   │   ├── LoginPage.jsx       # Authentication UI
│   │   ├── ResearchGraph.jsx   # D3.js knowledge graph
│   │   ├── PaperReader.jsx     # Paper analysis view
│   │   ├── PaperRanking.jsx    # Collapsible paper list
│   │   ├── AgentChat.jsx       # AI research agent (right panel)
│   │   ├── DoctorChat.jsx      # General AI chat
│   │   └── PatternBanner.jsx   # Decorative component
│   ├── services/
│   │   └── api.js              # API client with auth headers
│   ├── hooks/
│   │   └── useTopicTracker.js  # Topic detection hook
│   ├── App.jsx                 # Main app with auth gate
│   ├── App.css                 # All component styles
│   └── index.css               # Design system + login styles
├── .env.example                # Environment template
├── package.json
└── vite.config.js
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, D3.js 7 |
| Backend | Express 5, Node.js |
| Database | SQLite (better-sqlite3) |
| AI | Google Gemini 2.5 Flash |
| Auth | JWT + bcryptjs |
| Papers | Semantic Scholar API |
| Trials | ClinicalTrials.gov API |

### Data Flow

```
User query
  → Gemini extracts clinical concepts
  → Semantic Scholar searches for papers
  → Gemini analyzes relationships between papers
  → D3.js renders interactive knowledge graph
  → User clicks paper → AI generates highlights
  → AI agent provides proactive research questions
```

## API Reference

All endpoints require authentication via `Authorization: Bearer <token>` header, except `/api/auth/*`.

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account (email, password, name) |
| POST | `/api/auth/login` | Sign in (email, password) |
| GET | `/api/auth/verify` | Verify JWT token |

### Research Pipeline
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/extract-concepts` | Extract clinical concepts from a query |
| POST | `/api/search-papers` | Search Semantic Scholar for papers |
| POST | `/api/analyze-relationships` | Analyze relationships between papers |
| POST | `/api/summarize-papers` | Generate paper summaries |
| POST | `/api/extract-highlights` | Extract key highlights from a paper |
| POST | `/api/evidence-strength` | Score evidence level of papers |

### AI Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Chat with AI agent about papers |
| POST | `/api/doctor-chat` | General medical AI chat |
| POST | `/api/doctor-chat-web` | AI chat with web search grounding |
| POST | `/api/follow-up-questions` | Generate follow-up questions |

### Tools
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/clinical-trials` | Search ClinicalTrials.gov |
| POST | `/api/compare-papers` | Generate comparison table |
| POST | `/api/citation-chain` | Get citation/reference chain |
| POST | `/api/build-reading-list` | Create personalized reading list |
| POST | `/api/generate-brief` | Generate clinical research brief |
| POST | `/api/explain-contradiction` | Explain contradictions between papers |

## Development

### Run frontend only

```bash
npm run dev
```

### Run backend only

```bash
npm run server
```

### Build for production

```bash
npm run build
```

The built frontend files go to `dist/`. Serve them with any static file server and point to the Express backend.

## Contributing

Contributions are welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

### Guidelines

- Keep the UI dark-themed and clinically clean
- AI responses should be conversational, not robotic
- No markdown formatting in AI chat responses (plain text only)
- All API endpoints must be behind `requireAuth` middleware
- Test with real Semantic Scholar queries before submitting

## Disclaimer

ATLAS-MD is a research tool. It does not provide medical advice. AI-generated analyses should always be verified against primary sources. Do not use this tool for clinical decision-making without consulting qualified medical professionals.

## License

[MIT](LICENSE) — Sukriti Sehgal
