const API_BASE = 'http://localhost:3001/api';

function getAuthHeaders() {
  const token = localStorage.getItem('atlas-token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function post(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    localStorage.removeItem('atlas-token');
    window.dispatchEvent(new Event('atlas-auth-expired'));
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API request failed');
  }
  return res.json();
}

// Auth
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function register(email, password, name) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  return data;
}

export async function verifyToken() {
  const token = localStorage.getItem('atlas-token');
  if (!token) return null;
  const res = await fetch(`${API_BASE}/auth/verify`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    localStorage.removeItem('atlas-token');
    return null;
  }
  const data = await res.json();
  return data.user;
}

// Existing API functions
export async function extractResearchQuery(messages) {
  return post('/extract-research-query', { messages });
}

export async function extractConcepts(description) {
  return post('/extract-concepts', { description });
}

export async function searchPapers(concepts, yearRange = null) {
  return post('/search-papers', { concepts, yearRange });
}

export async function analyzeRelationships(papers) {
  return post('/analyze-relationships', { papers });
}

export async function summarizePapers(papers) {
  return post('/summarize-papers', { papers });
}

export async function extractHighlights(paper) {
  return post('/extract-highlights', { paper });
}

export async function chatWithAgent(messages, paper, highlights, allPapers = []) {
  return post('/chat', { messages, paper, highlights, allPapers });
}

export async function doctorChat(messages) {
  return post('/doctor-chat', { messages });
}

export async function doctorChatWeb(messages) {
  return post('/doctor-chat-web', { messages });
}

export async function explainContradiction(paper1, paper2) {
  return post('/explain-contradiction', { paper1, paper2 });
}

export async function buildReadingList(papers, query, profile) {
  return post('/build-reading-list', { papers, query, profile });
}

export async function extendReadingList(papers, query, profile, existingIds) {
  return post('/extend-reading-list', { papers, query, profile, existingIds });
}

export async function generateBrief(papers, highlights, query) {
  return post('/generate-brief', { papers, highlights, query });
}

export async function getEvidenceStrength(papers) {
  return post('/evidence-strength', { papers });
}

export async function searchClinicalTrials(query) {
  return post('/clinical-trials', { query });
}

export async function comparePapers(papers) {
  return post('/compare-papers', { papers });
}

export async function getCitationChain(paperId, direction) {
  return post('/citation-chain', { paperId, direction });
}

export async function getFollowUpQuestions(messages) {
  return post('/follow-up-questions', { messages });
}

// Sessions
export async function createSession(name) {
  return post('/sessions/create', { name });
}

export async function joinSession(sessionId) {
  return post('/sessions/join', { sessionId });
}

export async function listSessions() {
  const token = localStorage.getItem('atlas-token');
  const res = await fetch(`${API_BASE}/sessions`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load sessions');
  return res.json();
}

// Account
export async function deleteAccount() {
  const token = localStorage.getItem('atlas-token');
  const res = await fetch(`${API_BASE}/account`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete account');
  return res.json();
}

// Research Memory
export async function saveResearchMemory(query, concepts, paperCount, topPapers, summary) {
  return post('/memory/save', { query, concepts, paperCount, topPapers, summary });
}

export async function getResearchMemory() {
  const token = localStorage.getItem('atlas-token');
  const res = await fetch(`${API_BASE}/memory`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load research memory');
  return res.json();
}
