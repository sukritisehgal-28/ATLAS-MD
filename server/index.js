import 'dotenv/config';  // Must be first — loads .env before any module reads process.env
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { router as authRouter, requireAuth } from './auth.js';
import db from './db.js';
import { JWT_SECRET, isProduction } from './config.js';
import { indexPaper, retrieve, getPaperStatus } from './rag.js';

// Simple in-memory rate limiter
const rateLimitMap = new Map();
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;
    let hits = rateLimitMap.get(key) || [];
    hits = hits.filter(t => t > windowStart);
    if (hits.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    hits.push(now);
    rateLimitMap.set(key, hits);
    next();
  };
}
// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateLimitMap) {
    const filtered = hits.filter(t => t > now - 900000);
    if (filtered.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, filtered);
  }
}, 300000);

const app = express();

// Behind the TLS reverse proxy the real client IP arrives in X-Forwarded-For.
// Without this every request appears to come from the proxy itself and the whole
// site shares a single rate-limit bucket.
app.set('trust proxy', isProduction ? 1 : false);

const httpServer = createServer(app);

const allowedOrigins = (process.env.CORS_ORIGIN ||
  (isProduction ? 'https://atlasmd.live,https://www.atlasmd.live' : 'http://localhost:5173'))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Rate-limit ceilings, overridable so the integration test suite can run its
// request bursts without tripping the limiter.
const AUTH_RATE_LIMIT = Number(process.env.AUTH_RATE_LIMIT) || 10;
const API_RATE_LIMIT = Number(process.env.API_RATE_LIMIT) || 120;

// Auth routes (unprotected, rate-limited)
app.use('/api/auth', rateLimit(60000, AUTH_RATE_LIMIT), authRouter);

// All other /api routes require authentication (rate-limited).
// A single research query fans out to ~6 endpoints, plus one per paper opened,
// so this ceiling has to sit well above "one request per user action".
app.use('/api', rateLimit(60000, API_RATE_LIMIT), requireAuth);

// Default Gemini client (server-level key)
const defaultGenAI = process.env.Gemini_API_KEY ? new GoogleGenerativeAI(process.env.Gemini_API_KEY) : null;

// Model selection is a fallback CHAIN, not a single name, for two reasons:
//
//  1. Pinned versions get retired. The originally hardcoded 2.5-flash build was
//     withdrawn from new users, which silently broke every AI feature.
//  2. The Gemini free tier grants only ~20 requests per DAY *per model*, but
//     that quota is counted separately for each one. Rolling to the next model
//     when one is exhausted multiplies the daily budget without ever leaving
//     the free tier — which is the point, since the demo key belongs to a
//     project with billing disabled and must never be able to incur a charge.
//
// Override with GEMINI_MODELS (comma-separated) to re-order or pin.
const GEMINI_MODELS = (process.env.GEMINI_MODELS ||
  'gemini-3.1-flash-lite,gemini-flash-latest,gemini-3-flash-preview,gemini-3.5-flash,gemini-3.7-flash')
  .split(',').map((m) => m.trim()).filter(Boolean);

// Gemini 3.x spends output budget on internal reasoning before answering. That
// silently truncated JSON against these maxOutputTokens ceilings and burns
// free-tier quota, so reasoning is disabled for every call here.
const NO_THINKING = { thinkingBudget: 0 };

// Prefer the user's own key from Settings, fall back to the server key.
function getGeminiClient(req) {
  const userKey = req?.headers?.['x-gemini-key'];
  const ai = userKey ? new GoogleGenerativeAI(userKey) : defaultGenAI;
  if (!ai) throw new Error('No Gemini API key configured. Please add your key in Settings.');
  return ai;
}

// Get Semantic Scholar API key — prefer user's, fall back to server
function getScholarKey(req) {
  return req?.headers?.['x-scholar-key'] || process.env.SEMANTIC_SCHOLAR_API_KEY;
}

const RETRYABLE = [429, 500, 502, 503, 504];

function classifyError(err) {
  const msg = String(err?.message || '');
  return {
    status: Number(msg.match(/\[(\d{3})\s/)?.[1]),
    // A per-day quota will not recover by waiting, so move to the next model.
    // A per-minute one will, so it is worth sleeping for.
    exhaustedForToday: /PerDay/.test(msg),
    advisedSeconds: Number(msg.match(/retry in (\d+(?:\.\d+)?)s/)?.[1]),
  };
}

// Try each model in turn; within a model, retry transient failures with backoff.
async function generateWithFallback(req, request, { tools } = {}) {
  const ai = getGeminiClient(req);
  let lastErr;

  for (const name of GEMINI_MODELS) {
    const model = ai.getGenerativeModel(tools ? { model: name, tools } : { model: name });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await model.generateContent(request);
      } catch (err) {
        lastErr = err;
        const { status, exhaustedForToday, advisedSeconds } = classifyError(err);

        if (!RETRYABLE.includes(status)) throw err;
        if (exhaustedForToday) {
          console.warn(`[gemini] ${name} out of daily free-tier quota, trying next model`);
          break;
        }
        if (attempt === 1) {
          console.warn(`[gemini] ${name} still failing (${status}), trying next model`);
          break;
        }
        // Honour the server's own figure — plain backoff undershoots the window.
        const delay = Math.min(Math.max((advisedSeconds || 1) * 1000 + 500, 1000), 25000);
        console.warn(`[gemini] ${name} returned ${status}, retrying in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error('[gemini] every model in the chain failed');
  throw lastErr;
}

async function askGemini(prompt, maxTokens = 1024, req = null) {
  const result = await generateWithFallback(req, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: NO_THINKING },
  });
  const resp = result.response;
  const parts = resp.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

function repairJSON(text) {
  // Try parsing as-is first
  try { return JSON.parse(text); } catch (_) {}

  let s = text.trim();
  // Remove markdown fences if present
  s = s.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();

  // Try again after cleanup
  try { return JSON.parse(s); } catch (_) {}

  // Strategy 1: Find last complete key-value pair or array item
  // First, close any open strings by finding unmatched quotes
  let repaired = s;

  // Check if we're in an unclosed string (odd number of unescaped quotes)
  let quoteCount = 0;
  for (let i = 0; i < repaired.length; i++) {
    if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== '\\')) quoteCount++;
  }
  if (quoteCount % 2 !== 0) {
    // Truncate back to the last complete key-value or item
    // Find the last position where a value was complete (after a closing quote followed by , or } or ])
    let lastSafe = -1;
    let inStr = false;
    for (let i = 0; i < repaired.length; i++) {
      if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
        inStr = !inStr;
        if (!inStr) {
          // Just closed a string — check what follows (skip whitespace)
          let j = i + 1;
          while (j < repaired.length && /\s/.test(repaired[j])) j++;
          const next = repaired[j];
          if (next === ',' || next === '}' || next === ']' || next === ':') {
            lastSafe = j;
            if (next === ',') lastSafe = j; // include the comma
          }
        }
      }
    }
    if (lastSafe > 0) {
      repaired = repaired.slice(0, lastSafe);
      // Remove trailing comma
      repaired = repaired.replace(/,\s*$/, '');
    }
  }

  // Remove trailing commas before closing brackets
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // Close any remaining open brackets/braces
  const stack = [];
  let inS = false;
  for (let i = 0; i < repaired.length; i++) {
    if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== '\\')) { inS = !inS; continue; }
    if (inS) continue;
    if (repaired[i] === '{' || repaired[i] === '[') stack.push(repaired[i]);
    if (repaired[i] === '}' || repaired[i] === ']') stack.pop();
  }
  repaired = repaired.replace(/,\s*$/, '');
  while (stack.length) {
    const o = stack.pop();
    repaired += o === '{' ? '}' : ']';
  }
  try { return JSON.parse(repaired); } catch (_) {}

  // Strategy 2: For objects like {"key": {...}, "key2": {...}...}
  // Find all complete top-level key-value pairs
  const objMatch = s.match(/^\s*\{/);
  if (objMatch) {
    // Find complete "key": value pairs
    let result = '{';
    let depth = 0;
    let inStr2 = false;
    let lastCompleteComma = -1;

    for (let i = 1; i < s.length; i++) {
      if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) inStr2 = !inStr2;
      if (inStr2) continue;
      if (s[i] === '{' || s[i] === '[') depth++;
      if (s[i] === '}' || s[i] === ']') depth--;
      if (s[i] === ',' && depth === 0) lastCompleteComma = i;
    }

    if (lastCompleteComma > 0) {
      result = s.slice(0, lastCompleteComma) + '}';
      try { return JSON.parse(result); } catch (_) {}
    }
  }

  // Strategy 3: Extract complete array items
  const arrayMatch = s.match(/^(\s*\{\s*"[^"]+"\s*:\s*\[)([\s\S]*)/);
  if (arrayMatch) {
    const prefix = arrayMatch[1];
    const rest = arrayMatch[2];
    const completeObjects = [];
    let depth = 0;
    let inString = false;
    let objStart = -1;

    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === '"' && (i === 0 || rest[i - 1] !== '\\')) { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      if (ch === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          completeObjects.push(rest.slice(objStart, i + 1));
          objStart = -1;
        }
      }
    }

    if (completeObjects.length > 0) {
      const fixed = prefix + completeObjects.join(',') + ']}';
      try { return JSON.parse(fixed); } catch (_) {}
    }
  }

  // Last resort: return empty object/array based on structure
  console.error(`JSON repair failed, returning partial. Raw (first 300): ${s.slice(0, 300)}`);
  if (s.trimStart().startsWith('[')) return [];
  return {};
}

async function askGeminiJSON(prompt, maxTokens = 8192, req = null) {
  const result = await generateWithFallback(req, {
    contents: [{ role: 'user', parts: [{ text: prompt + '\n\nIMPORTANT: Keep your JSON response concise. Use short strings. Do NOT exceed the output limit.' }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      thinkingConfig: NO_THINKING,
    },
  });
  const text = result.response.text();
  return repairJSON(text);
}

// --- Semantic Scholar proxy ---
async function searchSemanticScholar(query, limit = 15, yearRange = null, req = null) {
  const headers = {};
  const scholarKey = getScholarKey(req);
  if (scholarKey) {
    headers['x-api-key'] = scholarKey;
  }
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: 'paperId,title,abstract,year,citationCount,authors,url,openAccessPdf,externalIds',
  });
  if (yearRange) {
    params.set('year', yearRange); // e.g. "2022-2026"
  }
  const res = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    { headers }
  );
  if (!res.ok) throw new Error(`Semantic Scholar error: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// --- Routes ---

// Extract a research query from conversation history (memory layer)
app.post('/api/extract-research-query', async (req, res) => {
  try {
    const { messages } = req.body;
    // Build conversation transcript
    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'Doctor' : 'AI'}: ${m.content}`)
      .join('\n');
    const json = await askGeminiJSON(
      `You are a medical research search query builder. A doctor has been chatting with an AI assistant and now wants to search for research papers. Analyze the full conversation below and extract the most relevant medical topic or clinical question they've been discussing.\n\nReturn JSON: {"query":"a concise search query (3-8 words) optimized for searching medical literature databases like Semantic Scholar","concepts":["concept1","concept2","concept3"]}\n\nPick up on specific conditions, drugs, mechanisms, treatments, or clinical scenarios mentioned. Focus on the medical substance, not conversational filler.\n\nConversation:\n${transcript}`,
      8192,
      req
    );
    res.json(json);
  } catch (err) {
    console.error('extract-research-query error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Extract clinical concepts from patient description
app.post('/api/extract-concepts', async (req, res) => {
  try {
    const { description } = req.body;
    const json = await askGeminiJSON(
      `Medical NLP. Extract key clinical concepts from a doctor's patient description. Return JSON: {"concepts":["c1","c2","c3"]}. Maximum 3 concepts. Be specific and clinically precise — prefer conditions and mechanisms over vague symptoms.\n\nPatient description: ${description}`,
      8192,
      req
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
    const { concepts, yearRange } = req.body;
    const query = concepts.join(' ');
    const allPapers = await searchSemanticScholar(query, 20, yearRange || null, req);
    // Filter out papers without abstracts — they're not useful for analysis
    const papers = allPapers.filter(p => p.abstract && p.abstract.trim().length > 0).slice(0, 15);
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
        4096,
        req
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
      4096,
      req
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

    // An abstract rarely states sample sizes or limitations, so when full text
    // has been indexed, pull the passages that actually discuss them and let
    // the model work from those instead.
    let evidence = paper.abstract || 'No abstract available';
    let groundedInFullText = false;
    if (getPaperStatus(paper.paperId)?.status === 'indexed') {
      try {
        const passages = await retrieve(
          paper.paperId,
          'key findings, primary outcome, methodology, sample size, limitations of the study',
          req,
          6
        );
        if (passages.length) {
          evidence = passages.map((x) => `(${x.section}) ${x.text}`).join('\n\n');
          groundedInFullText = true;
        }
      } catch (e) {
        console.warn('highlight retrieval failed, using abstract:', e.message);
      }
    }

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
          messages: [{ role: 'user', content: `Title: ${paper.title}\nYear: ${paper.year}\n${groundedInFullText ? 'Excerpts from full text' : 'Abstract'}: ${evidence}` }],
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.[0]?.text || '[]';
      highlights = JSON.parse(text.replace(/```json|```/g, '').trim());
    } else {
      const json = await askGeminiJSON(
        `Extract 4-5 clinically important highlights. Return JSON: {"highlights":[{"text":"highlight","importance":"critical|high|moderate","type":"finding|method|conclusion|limitation","passage":"verbatim sentence from the source text"}]}.\n\nEvery passage must be copied verbatim from the source text below — never invent one.\n\nTitle: ${paper.title}\n${groundedInFullText ? 'Full-text excerpts' : 'Abstract'}: ${evidence}`,
        1024,
        req
      );
      highlights = json.highlights || (Array.isArray(json) ? json : []);
    }

    res.json({ highlights: Array.isArray(highlights) ? highlights : [], groundedInFullText });
  } catch (err) {
    console.error('extract-highlights error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Chat with AI agent about a paper
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, paper, highlights, allPapers } = req.body;

    // Load cross-session memory for context
    let memoryContext = '';
    try {
      const memories = db.prepare(
        'SELECT query, concepts, paper_count, top_papers, summary, created_at FROM research_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
      ).all(req.user.userId);
      if (memories.length > 0) {
        const memLines = memories.map((m) => {
          const papers = JSON.parse(m.top_papers || '[]');
          const paperTitles = papers.map(p => p.title || p).join(', ');
          return `- "${m.query}" (${m.created_at}) — ${m.paper_count} papers${paperTitles ? ': ' + paperTitles.slice(0, 120) : ''}`;
        });
        memoryContext = `\n\nRESEARCH HISTORY (this doctor's past sessions — use for context and continuity):
${memLines.join('\n')}
When relevant, reference their past research naturally: "Since you looked at X before..." or "Building on your earlier work on..."`;
      }
    } catch (e) { console.error('Memory load error:', e); }

    let systemContext;
    if (paper.paperId === 'all' && allPapers?.length) {
      // Multi-paper context — agent on graph page with full details for recommendations
      const paperList = allPapers.slice(0, 15).map((p, i) => `${i + 1}. "${p.title}" (${p.year}) | Citations: ${p.citationCount || 0} | Authors: ${(p.authors || []).slice(0, 2).map(a => a.name).join(', ') || 'Unknown'}\n   Abstract: ${(p.abstract || 'No abstract available').slice(0, 250)}`).join('\n\n');
      systemContext = `You are ATLAS, a warm and knowledgeable medical research companion. You're helping a doctor explore a collection of ${allPapers.length} research papers. You have deep knowledge of every paper in this set.

Papers in this collection:
${paperList}

YOUR ROLE ON THIS PAGE:
- You are the doctor's research advisor overseeing ALL papers in this collection
- When asked "what should I read" or "where should I start", give specific recommendations based on the paper details above — consider recency, citation count, relevance, and study type
- When asked about themes, contradictions, or gaps — synthesize across all papers
- You can compare any papers in the set and explain how they relate
- If asked about a specific topic, point to the most relevant papers by name

CRITICAL STYLE RULES:
- Talk like a smart doctor friend texting — casual, warm, no fluff
- NEVER use markdown formatting. No asterisks, no bold (**), no italic (*), no headers (#), no bullet points with asterisks
- Use plain text only. Use dashes (-) if you need to list things
- NEVER output JSON, markdown tables, or structured data formats
- Reference papers by their actual titles naturally, e.g. "I'd start with the Smith et al. paper on X..."
- When comparing papers, speak naturally: "The 2024 study found X, but the earlier one contradicts that..."
- Keep responses 2-4 short paragraphs max. No walls of text
- Start replies directly with the answer — no "Great question!" or "Sure!" filler
- Be direct and useful — doctors are busy

ACTIONS:
- If the user asks you to find, search for, or provide papers on a topic, include this exact tag at the END of your reply: [SEARCH: topic here]
- Example: if user says "find me papers on CRISPR therapy", respond naturally and end with [SEARCH: CRISPR therapy]
- Only use this when the user is clearly asking you to fetch/find NEW papers, not when discussing papers already in the collection${memoryContext}`;
    } else {
      // Single paper context — but also include other papers if available for cross-referencing
      let otherPapersContext = '';
      if (allPapers?.length > 1) {
        const others = allPapers.filter(p => p.paperId !== paper.paperId).slice(0, 10);
        if (others.length > 0) {
          otherPapersContext = `\n\nOTHER PAPERS IN THIS RESEARCH SESSION (for comparison/context):
${others.map((p, i) => `${i + 1}. "${p.title}" (${p.year}) — ${(p.abstract || '').slice(0, 150)}`).join('\n')}

You can reference these other papers if asked to compare, contextualize, or recommend what to read next.`;
        }
      }

      systemContext = `You are ATLAS, a warm and knowledgeable medical research companion. You're helping a doctor read and analyze a specific paper.

CURRENTLY READING:
Title: "${paper.title}" (${paper.year})
Abstract: ${(paper.abstract || 'No abstract').slice(0, 500)}
Key highlights: ${(highlights || []).map((h) => h.text).join('; ')}${otherPapersContext}

YOUR ROLE:
- You are focused on THIS paper — answer questions about its findings, methods, limitations, clinical relevance
- If the doctor asks "what should I read next" or about other papers, you know what else is in their session
- Compare this paper against others in the collection when relevant

CRITICAL STYLE RULES:
- Talk like a smart doctor friend texting — casual, warm, no fluff
- NEVER use markdown formatting. No asterisks, no bold (**), no italic (*), no headers (#), no bullet points with asterisks
- Use plain text only. Use dashes (-) if you need to list things
- NEVER output JSON, markdown tables, or structured data formats
- Keep responses 2-4 short paragraphs max. No walls of text
- Start with the key insight, then add context
- Say "this paper shows..." or "interesting thing here..." not "Based on the provided abstract..."
- If you don't know something, say "I'd need to see the full text for that" naturally
- Start replies directly with the answer — no "Great question!" or "Sure!" or "Absolutely!" filler
- Be direct and useful — doctors are busy

ACTIONS:
- If the user asks you to find, search for, or provide papers on a topic, include this exact tag at the END of your reply: [SEARCH: topic here]
- Example: if user says "find me papers on CRISPR therapy", respond naturally and end with [SEARCH: CRISPR therapy]
- Only use this when the user is clearly asking you to fetch/find NEW papers, not when discussing papers already in the collection${memoryContext}`;
    }

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

    // Ensure alternating user/model roles (Gemini requirement)
    let lastRole = 'model'; // after the initial model acknowledgment
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (role === lastRole) {
        // Merge consecutive same-role messages
        const last = contents[contents.length - 1];
        if (last?.parts?.[0]) {
          last.parts[0].text += '\n\n' + m.content;
        }
      } else {
        contents.push({
          role,
          parts: [{ text: m.content }],
        });
      }
      lastRole = role;
    }

    const result = await generateWithFallback(req, {
      contents,
      generationConfig: { maxOutputTokens: 1024, thinkingConfig: NO_THINKING },
    });
    const reply = result?.response?.text?.() || 'Sorry, I couldn\'t generate a response. Please try again.';
    res.json({ reply });
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
      parts: [{ text: `You are ATLAS, a smart and friendly medical research companion for doctors. Think of yourself as a well-read colleague they're having a quick hallway conversation with.

You help with medical research questions, clinical concepts, drug mechanisms, treatment protocols, interpreting findings, and evidence-based reasoning.

STYLE RULES (critical):
- Talk like a knowledgeable friend, not a textbook. Be warm and direct.
- NEVER use markdown formatting. No asterisks (**), no bold, no italic, no headers (#).
- Use plain text only. If you list things, use simple dashes (-).
- Keep responses to 2-3 short paragraphs. No walls of text.
- Start with the answer, not preamble. No "Great question!" or "Absolutely!" filler.
- Use medical terminology naturally but explain complex concepts simply.
- If unsure, say so honestly — never make up clinical data.
- Sound human. Say things like "honestly," "the tricky part is," "what's interesting here is..."

Please acknowledge you're ready.` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Ready to assist. What can I help you with?' }],
    });

    let lastRole = 'model';
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (role === lastRole) {
        const last = contents[contents.length - 1];
        last.parts[0].text += '\n\n' + m.content;
      } else {
        contents.push({ role, parts: [{ text: m.content }] });
      }
      lastRole = role;
    }

    const result = await generateWithFallback(req, {
      contents,
      generationConfig: { maxOutputTokens: 2048, thinkingConfig: NO_THINKING },
    });
    const reply = result?.response?.text?.() || 'Sorry, I couldn\'t generate a response. Please try again.';
    res.json({ reply });
  } catch (err) {
    console.error('doctor-chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// General doctor chatbot with web search grounding
app.post('/api/doctor-chat-web', async (req, res) => {
  try {
    const { messages } = req.body;

    const contents = [];
    contents.push({
      role: 'user',
      parts: [{ text: `You are ATLAS, a smart and friendly medical research companion with web search. Search the web for the latest medical info, trials, drug approvals, and findings. Cite sources with URLs when possible.

STYLE RULES (critical):
- Talk like a knowledgeable friend, not a textbook. Warm and direct.
- NEVER use markdown formatting. No asterisks (**), no bold, no italic, no headers (#).
- Plain text only. Use dashes (-) for lists.
- Keep responses to 2-3 short paragraphs.
- Start with the answer. No filler phrases.
- Sound human and conversational.

Please acknowledge you're ready.` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Ready. I can search the web for the latest medical information. What would you like to know?' }],
    });

    let lastRole = 'model';
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (role === lastRole) {
        const last = contents[contents.length - 1];
        last.parts[0].text += '\n\n' + m.content;
      } else {
        contents.push({ role, parts: [{ text: m.content }] });
      }
      lastRole = role;
    }

    // Search grounding runs through the same fallback chain.
    const result = await generateWithFallback(req, {
      contents,
      generationConfig: { maxOutputTokens: 2048, thinkingConfig: NO_THINKING },
    }, { tools: [{ googleSearch: {} }] });
    const reply = result?.response?.text?.() || 'Sorry, I couldn\'t generate a response. Please try again.';
    res.json({ reply });
  } catch (err) {
    console.error('doctor-chat-web error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Explain why two papers contradict each other
app.post('/api/explain-contradiction', async (req, res) => {
  try {
    const { paper1, paper2 } = req.body;
    const prompt = `You are a medical research analyst. Two papers appear to contradict each other. In exactly 3 sentences, explain the most likely reasons for the contradiction — consider differences in patient populations, endpoints, methodology, sample size, or time periods.

Paper 1: "${paper1.title}" (${paper1.year})
Abstract: ${paper1.abstract || 'No abstract available'}

Paper 2: "${paper2.title}" (${paper2.year})
Abstract: ${paper2.abstract || 'No abstract available'}

Provide exactly 3 sentences explaining the contradiction.`;
    const explanation = await askGemini(prompt, 1024, req);
    res.json({ explanation });
  } catch (err) {
    console.error('explain-contradiction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Build a prioritized reading list from papers
app.post('/api/build-reading-list', async (req, res) => {
  try {
    const { papers, query, profile } = req.body;
    const paperSummaries = papers.map(
      (p) => `ID: ${p.paperId} | Title: ${p.title} | Year: ${p.year} | Citations: ${p.citationCount || 0} | Abstract: ${(p.abstract || '').slice(0, 200)}`
    );

    let profileContext = '';
    if (profile && (profile.experience || profile.role || profile.purpose)) {
      const exp = profile.experience || 'Not specified';
      const role = profile.role || 'Not specified';
      const purpose = profile.purpose || 'Not specified';
      const specialty = profile.specialty || 'Not specified';
      const depth = profile.depth || 'Not specified';
      profileContext = `\nReader Profile: ${exp} ${role}, Purpose: ${purpose}, Specialty: ${specialty}, Depth: ${depth}

Tailor the reading order:
- Student/beginner: MIX foundational review articles WITH recent breakthrough papers. Start with a recent review for overview, then alternate between seminal older papers and cutting-edge recent ones. Do NOT only show old or only show new.
- Experienced doctor: start with highest-impact papers, prioritize clinical relevance and recent advances
- Treating patient: prioritize papers with direct clinical applicability and treatment outcomes first
- Learning/curious: breadth-first, cover different aspects and methodologies`;
    }

    const prompt = `You are a medical research librarian. A doctor searched for "${query}" and found the papers below.${profileContext}

Pick the top 5 most important papers and rank them in optimal reading order for this specific reader. For each, give a short one-line reason explaining why it should be read in that position, personalized to the reader's profile.

Return JSON: {"readingList":[{"paperId":"exact_id","reason":"one-line reason"}, ...]}

Papers:
${paperSummaries.join('\n')}`;
    const json = await askGeminiJSON(prompt, 4096, req);
    console.log('[build-reading-list] Response keys:', Object.keys(json), 'readingList length:', json.readingList?.length);
    // Normalize: Gemini might return the array directly or wrapped
    const list = json.readingList || (Array.isArray(json) ? json : []);
    res.json({ readingList: list });
  } catch (err) {
    console.error('build-reading-list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Extend reading list with remaining papers
app.post('/api/extend-reading-list', async (req, res) => {
  try {
    const { papers, query, profile, existingIds } = req.body;
    const remaining = papers.filter((p) => !existingIds.includes(p.paperId));
    if (!remaining.length) return res.json({ readingList: [] });

    const paperSummaries = remaining.map(
      (p) => `ID: ${p.paperId} | Title: ${p.title} | Year: ${p.year} | Citations: ${p.citationCount || 0} | Abstract: ${(p.abstract || '').slice(0, 200)}`
    );

    let profileContext = '';
    if (profile) {
      profileContext = `\nReader: ${profile.experience || ''} ${profile.role || ''}, ${profile.purpose || ''}, ${profile.specialty || ''}, depth: ${profile.depth || ''}`;
    }

    const prompt = `Rank these remaining papers in reading order for a doctor who searched "${query}".${profileContext}\n\nReturn JSON: {"readingList":[{"paperId":"exact_id","reason":"one-line reason"}, ...]}\n\nPapers:\n${paperSummaries.join('\n')}`;
    const json = await askGeminiJSON(prompt, 4096, req);
    const list = json.readingList || (Array.isArray(json) ? json : []);
    res.json({ readingList: list });
  } catch (err) {
    console.error('extend-reading-list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generate a clinical research brief
app.post('/api/generate-brief', async (req, res) => {
  try {
    const { papers, highlights, query } = req.body;
    const paperDetails = papers.map(
      (p) => `- "${p.title}" (${p.year}) — ${(p.abstract || 'No abstract').slice(0, 300)}`
    );
    const highlightText = highlights
      ? Object.entries(highlights)
          .map(([id, hs]) => {
            const items = Array.isArray(hs) ? hs : [];
            return items.map((h) => `  • ${h.text || h}`).join('\n');
          })
          .join('\n')
      : 'None provided';
    const prompt = `You are a senior clinical researcher. Generate a concise clinical research brief for a doctor who searched for "${query}".

Format the brief with these exact sections:
## Background
## Key Findings
## Contradictions
## Recommendations
## References

Papers reviewed:
${paperDetails.join('\n')}

Key highlights extracted:
${highlightText}

Write in clear clinical language. Be specific and evidence-based. Keep it concise but thorough.`;
    const brief = await askGemini(prompt, 3000, req);
    res.json({ brief });
  } catch (err) {
    console.error('generate-brief error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Classify evidence strength for papers
app.post('/api/evidence-strength', async (req, res) => {
  try {
    const { papers } = req.body;
    const paperSummaries = papers.map(
      (p) => `ID: ${p.paperId} | Title: ${p.title} | Abstract: ${(p.abstract || '').slice(0, 300)}`
    );
    const json = await askGeminiJSON(
      `You are a medical evidence classifier. For each paper, classify its study type and evidence level.

Evidence hierarchy (highest to lowest):
- Level 1: Systematic Review / Meta-Analysis
- Level 2: Randomized Controlled Trial (RCT)
- Level 3: Cohort Study
- Level 4: Case-Control Study
- Level 5: Case Series / Case Report
- Level 6: Expert Opinion / Editorial / Narrative Review

Return JSON: {"evidence":{"paperId":{"level":1-6,"type":"Systematic Review|RCT|Cohort Study|Case-Control|Case Series|Expert Opinion","confidence":"high|medium|low","reason":"one-line reason"},...}}

Papers:
${paperSummaries.join('\n')}`,
      4096,
      req
    );
    res.json(json);
  } catch (err) {
    console.error('evidence-strength error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Search ClinicalTrials.gov for related trials
app.post('/api/clinical-trials', async (req, res) => {
  try {
    const { query } = req.body;
    const params = new URLSearchParams({
      'query.term': query,
      pageSize: '10',
      format: 'json',
    });

    // Try up to 2 times in case of transient failures
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) break;
      } catch (fetchErr) {
        if (attempt === 1) throw fetchErr;
        // Wait briefly before retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!response || !response.ok) {
      // Return empty trials instead of error so frontend shows "no trials found"
      return res.json({ trials: [], message: 'ClinicalTrials.gov did not return results. Try a different query.' });
    }

    const data = await response.json();
    const trials = (data.studies || []).map((s) => {
      const p = s.protocolSection || {};
      const id = p.identificationModule || {};
      const status = p.statusModule || {};
      const design = p.designModule || {};
      const conditions = p.conditionsModule || {};
      const interventions = p.armsInterventionsModule || {};
      const sponsor = p.sponsorCollaboratorsModule || {};
      return {
        nctId: id.nctId || '',
        title: id.briefTitle || '',
        status: status.overallStatus || '',
        phase: (design.phases || []).join(', ') || 'N/A',
        startDate: status.startDateStruct?.date || '',
        completionDate: status.completionDateStruct?.date || '',
        enrollment: design.enrollmentInfo?.count || 0,
        conditions: (conditions.conditions || []).slice(0, 3),
        interventions: (interventions.interventions || []).map((i) => i.name).slice(0, 3),
        sponsor: sponsor.leadSponsor?.name || '',
      };
    });
    res.json({ trials });
  } catch (err) {
    console.error('clinical-trials error:', err);
    // Return empty trials with message instead of 500 error
    res.json({ trials: [], message: 'Could not reach ClinicalTrials.gov. Please try again.' });
  }
});

// Generate comparison table for selected papers
app.post('/api/compare-papers', async (req, res) => {
  try {
    const { papers } = req.body;
    const paperDetails = papers.map(
      (p) => `Title: ${p.title}\nYear: ${p.year}\nAbstract: ${(p.abstract || 'No abstract').slice(0, 400)}`
    );
    const json = await askGeminiJSON(
      `You are a medical research analyst. Compare these ${papers.length} papers side by side.

Return JSON: {
  "columns": ["Paper 1 short title", "Paper 2 short title", ...],
  "rows": [
    {"category": "Study Type", "values": ["RCT", "Cohort", ...]},
    {"category": "Population", "values": ["...", "..."]},
    {"category": "Sample Size", "values": ["...", "..."]},
    {"category": "Primary Outcome", "values": ["...", "..."]},
    {"category": "Key Finding", "values": ["...", "..."]},
    {"category": "Limitations", "values": ["...", "..."]},
    {"category": "Clinical Relevance", "values": ["...", "..."]}
  ]
}

Papers:
${paperDetails.join('\n\n---\n\n')}`,
      4096,
      req
    );
    res.json(json);
  } catch (err) {
    console.error('compare-papers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get citation chain (cited by / cites) from Semantic Scholar
app.post('/api/citation-chain', async (req, res) => {
  try {
    const { paperId, direction } = req.body;
    if (!paperId || typeof paperId !== 'string' || !/^[a-f0-9]{40}$/.test(paperId)) {
      return res.status(400).json({ error: 'Invalid paper ID format.' });
    }
    if (!['citations', 'references'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction.' });
    } // direction: 'citations' (cited by) or 'references' (cites)
    const headers = {};
    const scholarKey = getScholarKey(req);
    if (scholarKey) {
      headers['x-api-key'] = scholarKey;
    }
    const fields = 'paperId,title,year,citationCount,authors,abstract';
    const url = `https://api.semanticscholar.org/graph/v1/paper/${paperId}/${direction}?fields=${fields}&limit=10`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Semantic Scholar error: ${response.status}`);
    const data = await response.json();
    // citations returns {citingPaper: {...}}, references returns {citedPaper: {...}}
    const papers = (data.data || []).map((item) => {
      const p = direction === 'citations' ? item.citingPaper : item.citedPaper;
      return p;
    }).filter((p) => p && p.paperId);
    res.json({ papers });
  } catch (err) {
    console.error('citation-chain error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generate smart follow-up questions based on conversation
app.post('/api/follow-up-questions', async (req, res) => {
  try {
    const { messages } = req.body;
    const transcript = messages
      .slice(-6) // Last 6 messages for context
      .map((m) => `${m.role === 'user' ? 'Doctor' : 'AI'}: ${m.content}`)
      .join('\n');
    const json = await askGeminiJSON(
      `Based on this conversation between a doctor and an AI assistant, suggest exactly 1 follow-up question the doctor could TYPE INTO THIS CHAT to dig deeper.

This is a question the doctor asks THE AI, NOT a question to ask a patient. It should request more medical knowledge, research details, clinical evidence, or treatment comparisons.

Good examples: "What are the side effects of that drug?", "How does this compare to the 2024 guidelines?"
Bad examples: "How does stress impact your pain?" (this is asking a patient)

Return JSON: {"questions":["q1"]}
Under 60 characters. Make it the most interesting or clinically relevant follow-up.

Conversation:
${transcript}`,
      8192,
      req
    );
    res.json(json);
  } catch (err) {
    console.error('follow-up-questions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Full-text retrieval (RAG) =====

// Fetch, chunk and embed a paper's full text. Safe to call repeatedly — an
// already-indexed paper returns from cache without re-embedding.
app.post('/api/paper/index', async (req, res) => {
  try {
    const { paper } = req.body;
    if (!paper?.paperId) return res.status(400).json({ error: 'paper.paperId is required.' });
    res.json(await indexPaper(paper, req));
  } catch (err) {
    console.error('paper/index error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Whether full text is already available, so the UI can label a paper as
// full-text or abstract-only rather than silently degrading.
app.get('/api/paper/:paperId/status', (req, res) => {
  const row = getPaperStatus(req.params.paperId);
  res.json({
    status: row?.status || 'unknown',
    chunkCount: row?.chunk_count || 0,
    sourceUrl: row?.source_url || null,
  });
});

// Answer a question grounded in retrieved passages, with citations.
app.post('/api/paper/ask', async (req, res) => {
  try {
    const { paper, question } = req.body;
    if (!paper?.paperId || !question) {
      return res.status(400).json({ error: 'paper and question are required.' });
    }

    // Index on first use so the client never has to sequence two calls.
    let status = getPaperStatus(paper.paperId);
    if (status?.status !== 'indexed') {
      const result = await indexPaper(paper, req);
      if (result.status !== 'indexed') {
        return res.json({
          grounded: false,
          reason: result.reason || 'full_text_unavailable',
          answer: null,
          passages: [],
        });
      }
      status = getPaperStatus(paper.paperId);
    }

    const passages = await retrieve(paper.paperId, question, req, 6);
    if (!passages.length) {
      return res.json({ grounded: false, reason: 'no_passages', answer: null, passages: [] });
    }

    const numbered = passages
      .map((p, i) => `[${i + 1}] (section: ${p.section})\n${p.text}`)
      .join('\n\n');

    const prompt = `You are helping a clinician read a specific paper. Answer their question using ONLY the numbered passages below, which are verbatim excerpts from the paper's full text.

Rules:
- Cite the passage number inline for every claim, like [1] or [2].
- If the passages do not contain the answer, say so plainly. Do NOT use outside knowledge or guess.
- Plain text only. No markdown, no asterisks, no headers.
- 2-4 sentences. Be specific with numbers, populations and endpoints.

Paper: "${paper.title}"
Question: ${question}

Passages:
${numbered}`;

    const answer = await askGemini(prompt, 800, req);
    res.json({
      grounded: true,
      answer,
      passages: passages.map((p, i) => ({
        n: i + 1,
        section: p.section,
        text: p.text,
        score: Number(p.score.toFixed(3)),
      })),
      sourceUrl: status?.source_url || null,
    });
  } catch (err) {
    console.error('paper/ask error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Delete Account =====
app.delete('/api/account', (req, res) => {
  try {
    const userId = req.user.userId;
    // Delete in order: memory, session_members, sessions created by user, then user
    db.prepare('DELETE FROM research_memory WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM session_members WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE created_by = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

// ===== Cross-Session Research Memory =====

// Save a research session to memory
app.post('/api/memory/save', (req, res) => {
  try {
    const { query, concepts, paperCount, topPapers, summary } = req.body;
    db.prepare(
      'INSERT INTO research_memory (user_id, query, concepts, paper_count, top_papers, summary) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      req.user.userId,
      query,
      JSON.stringify(concepts || []),
      paperCount || 0,
      JSON.stringify((topPapers || []).slice(0, 5)),
      summary || ''
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Save memory error:', err);
    res.status(500).json({ error: 'Failed to save research memory.' });
  }
});

// Get all research memories for the user
app.get('/api/memory', (req, res) => {
  try {
    const memories = db.prepare(
      'SELECT * FROM research_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.user.userId);
    // Parse JSON fields
    const parsed = memories.map((m) => ({
      ...m,
      concepts: JSON.parse(m.concepts || '[]'),
      top_papers: JSON.parse(m.top_papers || '[]'),
    }));
    res.json({ memories: parsed });
  } catch (err) {
    console.error('Get memory error:', err);
    res.status(500).json({ error: 'Failed to load research memory.' });
  }
});

// ===== Collaborative Sessions =====

function generateSessionId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Create a session
app.post('/api/sessions/create', (req, res) => {
  try {
    const { name } = req.body;
    const sessionId = generateSessionId();
    const sessionName = (name || 'Research Session').slice(0, 100);

    db.prepare('INSERT INTO sessions (id, name, created_by) VALUES (?, ?, ?)').run(
      sessionId, sessionName, req.user.userId
    );
    db.prepare('INSERT INTO session_members (session_id, user_id) VALUES (?, ?)').run(
      sessionId, req.user.userId
    );

    console.log(`[Session] Created: ${sessionId} "${sessionName}" by user ${req.user.userId}`);
    res.json({ sessionId, name: sessionName });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session.' });
  }
});

// Join a session
app.post('/api/sessions/join', (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Session ID required.' });

    const sid = sessionId.toLowerCase().trim();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid);
    if (!session) return res.status(404).json({ error: 'Session not found. Check the code and try again.' });

    // Add member if not already in
    const existing = db.prepare('SELECT * FROM session_members WHERE session_id = ? AND user_id = ?').get(sid, req.user.userId);
    if (!existing) {
      db.prepare('INSERT INTO session_members (session_id, user_id) VALUES (?, ?)').run(sid, req.user.userId);
    }

    console.log(`[Session] Joined: ${sid} by user ${req.user.userId}`);
    res.json({ sessionId: session.id, name: session.name });
  } catch (err) {
    console.error('Join session error:', err);
    res.status(500).json({ error: 'Failed to join session.' });
  }
});

// Get user's sessions
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT s.id, s.name, s.created_at, s.created_by,
        (SELECT COUNT(*) FROM session_members WHERE session_id = s.id) as member_count
      FROM sessions s
      JOIN session_members sm ON s.id = sm.session_id
      WHERE sm.user_id = ?
      ORDER BY s.created_at DESC
    `).all(req.user.userId);
    res.json({ sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Failed to list sessions.' });
  }
});

// ===== Socket.io for real-time collaboration =====


// Track active users per room: { sessionId: { socketId: { userId, name, email } } }
const activeRooms = {};
// Track shared research state per room: { sessionId: { tabs, chatMessages } }
const roomState = {};

// Log raw socket.io engine connections
io.engine.on('connection', (rawSocket) => {
  console.log('[Engine] Raw transport connection from:', rawSocket.remoteAddress);
});

// Authenticate socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) { return next(new Error('Authentication required')); }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(decoded.userId);
    if (!user) { return next(new Error('User not found')); }
    socket.user = user;
    next();
  } catch (err) {
    console.log('[Socket Auth] REJECTED:', err.message);
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.user.name} (${socket.id})`);

  // Join a research session room
  socket.on('join-session', (sessionId) => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return socket.emit('error', 'Session not found');

    socket.join(sessionId);
    socket.sessionId = sessionId;
    console.log(`[Socket] ${socket.user.name} joined room ${sessionId}`);

    // Track presence
    if (!activeRooms[sessionId]) activeRooms[sessionId] = {};
    activeRooms[sessionId][socket.id] = {
      userId: socket.user.id,
      name: socket.user.name,
      email: socket.user.email,
    };

    const memberCount = Object.keys(activeRooms[sessionId]).length;
    console.log(`[Socket] Room ${sessionId} now has ${memberCount} members`);

    // Init room state
    if (!roomState[sessionId]) {
      roomState[sessionId] = { chatMessages: [] };
    }

    // Send chat history to joiner
    socket.emit('chat-history', roomState[sessionId].chatMessages);

    // Broadcast presence with host info
    const hostUser = db.prepare('SELECT name FROM users WHERE id = ?').get(session.created_by);
    const presenceData = {
      members: Object.values(activeRooms[sessionId]),
      hostUserId: session.created_by,
      hostName: hostUser?.name || 'Host',
    };
    console.log(`[Socket] Broadcasting presence:`, JSON.stringify(presenceData));
    io.to(sessionId).emit('presence', presenceData);

    // Notify everyone that someone joined
    socket.to(sessionId).emit('user-joined', { name: socket.user.name });

    // Notify host that someone wants to join (if not the host)
    if (socket.user.id !== session.created_by) {
      socket.to(sessionId).emit('join-request', {
        userId: socket.user.id,
        name: socket.user.name,
        socketId: socket.id,
      });
    }
  });

  // Host broadcasts their entire app state — relay to all members
  socket.on('state-snapshot', (data) => {
    if (!socket.sessionId) return;
    // Only the host can broadcast state snapshots
    const session = db.prepare('SELECT created_by FROM sessions WHERE id = ?').get(socket.sessionId);
    if (!session || session.created_by !== socket.user.id) return;
    socket.to(socket.sessionId).emit('state-snapshot', data);
  });

  // Chat messages
  socket.on('chat-message', (data) => {
    if (!socket.sessionId) return;
    const text = typeof data.text === 'string' ? data.text.slice(0, 2000).trim() : '';
    if (!text) return;
    const msg = {
      id: Date.now(),
      text: text,
      from: socket.user.name,
      userId: socket.user.id,
      timestamp: new Date().toISOString(),
    };
    if (roomState[socket.sessionId]) {
      roomState[socket.sessionId].chatMessages.push(msg);
      if (roomState[socket.sessionId].chatMessages.length > 100) {
        roomState[socket.sessionId].chatMessages = roomState[socket.sessionId].chatMessages.slice(-100);
      }
    }
    io.to(socket.sessionId).emit('chat-message', msg);
  });

  socket.on('bookmark-toggled', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('bookmark-toggled', data);
    }
  });

  // Helper: broadcast full presence with host info
  function broadcastPresence(sessionId) {
    if (!activeRooms[sessionId]) return;
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return;
    const host = db.prepare('SELECT name FROM users WHERE id = ?').get(session.created_by);
    io.to(sessionId).emit('presence', {
      members: Object.values(activeRooms[sessionId]),
      hostUserId: session.created_by,
      hostName: host?.name || 'Host',
    });
  }

  // Helper: check if leaving user is the host and notify members
  function handleUserLeaving(sessionId) {
    if (!sessionId || !activeRooms[sessionId]) return;
    const session = db.prepare('SELECT created_by FROM sessions WHERE id = ?').get(sessionId);
    const isHost = session && session.created_by === socket.user.id;

    delete activeRooms[sessionId][socket.id];
    if (Object.keys(activeRooms[sessionId]).length === 0) {
      delete activeRooms[sessionId];
      delete roomState[sessionId];
    } else {
      if (isHost) {
        // Notify all members that the session has ended
        io.to(sessionId).emit('session-ended', { hostName: socket.user.name });
      } else {
        broadcastPresence(sessionId);
      }
    }
    socket.to(sessionId).emit('user-left', { name: socket.user.name });
  }

  // Leave session
  socket.on('leave-session', () => {
    if (socket.sessionId) {
      const sessionId = socket.sessionId;
      socket.leave(sessionId);
      handleUserLeaving(sessionId);
      socket.sessionId = null;
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.user.name}`);
    if (socket.sessionId) {
      handleUserLeaving(socket.sessionId);
    }
  });
});

// Serve Vite production build in production
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, '..', 'dist');

import fs from 'fs';
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback — serve index.html for any non-API route. API and socket paths
  // fall through to the 404 below rather than hanging with no response.
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(join(distPath, 'index.html'));
  });
}

// Unmatched API routes get a real status instead of an open connection.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`ATLAS API server running on port ${PORT}`);
});
