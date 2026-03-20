import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.Gemini_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function askGemini(prompt, maxTokens = 1024) {
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  });
  const resp = result.response;
  // Collect all text parts from candidates
  const parts = resp.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

async function askGeminiJSON(prompt, maxTokens = 2048) {
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
  });
  const text = result.response.text();
  return JSON.parse(text);
}

function extractJSON(text) {
  // Try to extract JSON from markdown code blocks or raw text
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  return JSON.parse(raw);
}

// --- Semantic Scholar proxy ---
async function searchSemanticScholar(query, limit = 15) {
  const headers = {};
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: 'paperId,title,abstract,year,citationCount,authors,url,openAccessPdf',
  });
  const res = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    { headers }
  );
  if (!res.ok) throw new Error(`Semantic Scholar error: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// --- Routes ---

// Extract clinical concepts from patient description
app.post('/api/extract-concepts', async (req, res) => {
  try {
    const { description } = req.body;
    const json = await askGeminiJSON(
      `Medical NLP. Extract key clinical concepts from a doctor's patient description. Return JSON: {"concepts":["c1","c2","c3"]}. Maximum 3 concepts. Be specific and clinically precise — prefer conditions and mechanisms over vague symptoms.\n\nPatient description: ${description}`
    );
    res.json(json);
  } catch (err) {
    console.error('extract-concepts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Search papers
app.post('/api/search-papers', async (req, res) => {
  try {
    const { concepts } = req.body;
    const query = concepts.join(' ');
    const papers = await searchSemanticScholar(query, 15);
    res.json({ papers });
  } catch (err) {
    console.error('search-papers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Analyze paper relationships (Claude when available, Gemini fallback)
app.post('/api/analyze-relationships', async (req, res) => {
  try {
    const { papers } = req.body;
    const paperSummaries = papers.map(
      (p) => `ID: ${p.paperId} | Title: ${p.title} | Abstract: ${(p.abstract || '').slice(0, 200)}`
    );
    const validIds = papers.map((p) => p.paperId);
    let relationships;

    if (process.env.CLAUDE_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: `You are a medical research paper analyst. Return ONLY a valid JSON array:\n[{"paper1_id":"exact_id","paper2_id":"exact_id","type":"shared_concept|contradiction|methodology","strength":0.1-1.0,"reason":"under 80 chars"}]\nGenerate 8-15 relationships. Use EXACT IDs.`,
          messages: [{ role: 'user', content: `Valid IDs: ${JSON.stringify(validIds)}\n\nPapers:\n${paperSummaries.join('\n')}` }],
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.[0]?.text || '[]';
      relationships = JSON.parse(text.replace(/```json|```/g, '').trim());
    } else {
      const json = await askGeminiJSON(
        `Medical research analyst. Return JSON: {"relationships":[{"paper1_id":"id","paper2_id":"id","type":"shared_concept|contradiction|methodology","strength":0.8,"reason":"short reason"}]}.\nUse EXACT IDs: ${JSON.stringify(validIds)}\nPapers:\n${paperSummaries.join('\n')}`,
        4096
      );
      relationships = json.relationships || json;
    }

    console.log(`[analyze-relationships] Got ${relationships.length} relationships`);
    const filtered = relationships.filter(
      (r) => validIds.includes(r.paper1_id) && validIds.includes(r.paper2_id)
    );
    console.log(`[analyze-relationships] After filtering: ${filtered.length}`);
    res.json({ relationships: filtered });
  } catch (err) {
    console.error('analyze-relationships error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generate 4-line summaries for papers
app.post('/api/summarize-papers', async (req, res) => {
  try {
    const { papers } = req.body;
    const json = await askGeminiJSON(
      `For each of the following medical research papers, write exactly 4 concise lines for a clinician. Cover: key finding, patient population, primary outcome, clinical relevance. Be specific. No hedging. Return a JSON object: {"summaries": {"paperId": "4-line summary", ...}}.\n\nPapers:\n${papers.map((p) => `ID: ${p.paperId} | Title: ${p.title} | Abstract: ${(p.abstract || 'No abstract').slice(0, 300)}`).join('\n\n')}`,
      4096
    );
    res.json(json);
  } catch (err) {
    console.error('summarize-papers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Extract highlights (Claude when available, Gemini fallback)
app.post('/api/extract-highlights', async (req, res) => {
  try {
    const { paper } = req.body;
    let highlights;

    if (process.env.CLAUDE_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: `Extract 4-5 clinically important highlights. Return ONLY valid JSON array:\n[{"text":"finding max 30 words","importance":"critical|high|moderate","type":"finding|method|conclusion|limitation","passage":"verbatim substring from abstract"}]\nNEVER fabricate info not in the abstract.`,
          messages: [{ role: 'user', content: `Title: ${paper.title}\nYear: ${paper.year}\nAbstract: ${paper.abstract || 'No abstract available'}` }],
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.[0]?.text || '[]';
      highlights = JSON.parse(text.replace(/```json|```/g, '').trim());
    } else {
      const json = await askGeminiJSON(
        `Extract 4-5 clinically important highlights. Return JSON: {"highlights":[{"text":"highlight","importance":"critical|high|moderate","type":"finding|method|conclusion|limitation","passage":"verbatim sentence from abstract"}]}.\n\nTitle: ${paper.title}\nAbstract: ${paper.abstract || 'No abstract available'}`,
        1024
      );
      highlights = json.highlights || (Array.isArray(json) ? json : []);
    }

    res.json({ highlights: Array.isArray(highlights) ? highlights : [] });
  } catch (err) {
    console.error('extract-highlights error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Chat with AI agent about a paper
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, paper, highlights } = req.body;
    const systemContext = `You are an expert medical research assistant helping a doctor analyze a specific paper during active diagnosis.

Paper: "${paper.title}" (${paper.year})
Abstract: ${(paper.abstract || 'No abstract').slice(0, 500)}
Key highlights: ${highlights.map((h) => h.text).join('; ')}

Be concise, clinically precise, and directly useful. If the doctor's question goes beyond this paper's scope, say so and offer to help find related research. Never hallucinate clinical data.`;

    // Build conversation history for Gemini
    const contents = [];
    // Prepend system context as first user message
    contents.push({
      role: 'user',
      parts: [{ text: systemContext + '\n\nPlease acknowledge you understand this context and are ready to help.' }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Understood. I have the paper context loaded and am ready to help you analyze it. What would you like to know?' }],
    });

    for (const m of messages) {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }

    const result = await model.generateContent({
      contents,
      generationConfig: { maxOutputTokens: 1024 },
    });
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// General doctor chatbot (no paper context needed)
app.post('/api/doctor-chat', async (req, res) => {
  try {
    const { messages } = req.body;

    const contents = [];
    contents.push({
      role: 'user',
      parts: [{ text: `You are ATLAS, an AI-powered clinical research assistant for doctors. You help with:
- Answering medical research questions
- Explaining clinical concepts, drug mechanisms, treatment protocols
- Summarizing latest evidence on medical topics
- Helping interpret lab results and clinical findings
- Discussing differential diagnoses
- Providing evidence-based recommendations with citations when possible

Be concise, clinically precise, and use medical terminology appropriately. Format responses clearly with bullet points or numbered lists when helpful. If you're unsure about something, say so — never hallucinate clinical data. Always remind the doctor to verify critical decisions with primary sources.

Please acknowledge you're ready.` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Ready to assist. What can I help you with?' }],
    });

    for (const m of messages) {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }

    const result = await model.generateContent({
      contents,
      generationConfig: { maxOutputTokens: 2048 },
    });
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error('doctor-chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ATLAS API server running on port ${PORT}`);
});
