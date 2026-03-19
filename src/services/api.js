const API_BASE = 'http://localhost:3001/api';

async function post(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API request failed');
  }
  return res.json();
}

export async function extractConcepts(description) {
  return post('/extract-concepts', { description });
}

export async function searchPapers(concepts) {
  return post('/search-papers', { concepts });
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

export async function chatWithAgent(messages, paper, highlights) {
  return post('/chat', { messages, paper, highlights });
}

export async function doctorChat(messages) {
  return post('/doctor-chat', { messages });
}
