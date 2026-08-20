// Retrieval-augmented generation over full-text papers.
//
// The rest of the app reasons over abstracts, which are ~200 words and rarely
// contain the things clinicians actually need — sample sizes, effect estimates,
// the limitations section. When a paper has an open-access PDF we pull the full
// text, chunk it, embed the chunks, and retrieve only the passages relevant to
// a given question. Answers can then quote the source paragraph instead of
// paraphrasing an abstract.
import { PDFParse } from 'pdf-parse';
import db from './db.js';

const EMBED_MODEL = 'gemini-embedding-001';
// 768 instead of the default 3072: a quarter the storage and distance-math cost,
// with no meaningful retrieval loss at this corpus size (hundreds of chunks).
const EMBED_DIMS = 768;
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS = 220;          // ~260k chars; guards memory on a 1GiB instance
const BATCH_SIZE = 50;
// Institutional repositories often serve a cover sheet — copyright notice and
// citation metadata, no article — under the same "openAccessPdf" link. Those
// come in around 2-3k characters, so anything below this floor is treated as
// no full text rather than being indexed and labelled as the real thing.
const MIN_FULL_TEXT_CHARS = 10000;

// Headings we expect in a clinical paper. Each chunk is tagged with the most
// recent one so retrieved passages can be attributed to a section.
const SECTION_RE = /^\s*(?:\d+\.?\s*)?(abstract|background|introduction|methods?|materials and methods|results?|discussion|limitations?|conclusions?|references)\b/i;

function resolveKey(req) {
  const key = req?.headers?.['x-gemini-key'] || process.env.Gemini_API_KEY;
  if (!key) throw new Error('No Gemini API key configured. Please add your key in Settings.');
  return key;
}

// --- 1. Fetch -------------------------------------------------------------

// Full text comes from PubMed Central via NCBI's E-utilities API.
//
// Two earlier routes were tried and rejected: publisher "openAccessPdf" links
// mostly resolve to bot-detection or consent interstitials (Nature, Elsevier,
// MDPI and Oxford all return a ~3KB page rather than a PDF), and scraping the
// PMC website gets rate-limited into a block page after a handful of requests.
// E-utilities is the supported programmatic interface and returns JATS XML,
// which carries real section structure instead of headings we would have to
// guess at. A direct PDF is still tried as a fallback.
const NCBI_TOOL = 'atlas-md';
const NCBI_EMAIL = process.env.NCBI_EMAIL || 'demo@atlasmd.live';

function extractPmcId(paper) {
  const raw = paper?.externalIds?.PubMedCentral || paper?.externalIds?.PMC;
  if (!raw) return null;
  const digits = String(raw).replace(/^PMC/i, '').trim();
  return /^\d+$/.test(digits) ? digits : null;
}

// Turn JATS into plain text, marking section titles with a "## " prefix so the
// chunker can attribute each passage to the section it came from.
//
// Only <abstract> and <body> are kept. JATS front matter is a wall of author
// names, affiliations and funding statements, and <back> holds acknowledgements
// and author contributions — indexing those buries the clinical content, and a
// query for "limitations" comes back with the author-contributions paragraph.
function jatsToText(xml) {
  const sections = [];
  const abstract = xml.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i);
  if (abstract) sections.push('## Abstract\n' + abstract[1]);
  const body = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) sections.push(body[1]);
  if (!sections.length) return '';

  let x = sections.join('\n');
  // Bulk without clinical answers: citations, figures, tables, formulae.
  x = x.replace(/<ref-list[\s\S]*?<\/ref-list>/gi, ' ');
  x = x.replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, ' ');
  x = x.replace(/<fig[\s\S]*?<\/fig>/gi, ' ');
  x = x.replace(/<disp-formula[\s\S]*?<\/disp-formula>/gi, ' ');

  x = x.replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, (_m, t) => `\n## ${t.replace(/<[^>]+>/g, '').trim()}\n`);
  x = x.replace(/<\/(p|sec|abstract|body)>/gi, '\n');
  x = x.replace(/<[^>]+>/g, ' ');

  return x
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function fetchPmcFullText(pmcDigits) {
  const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'
    + `?db=pmc&id=${pmcDigits}&retmode=xml&tool=${NCBI_TOOL}&email=${encodeURIComponent(NCBI_EMAIL)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { ok: false, reason: 'pmc_http_' + res.status };

  const xml = await res.text();
  // Without a <body> the record is metadata only — abstract-only, no full text.
  if (!/<body[\s>]/i.test(xml)) return { ok: false, reason: 'pmc_no_full_text' };

  const text = jatsToText(xml);
  return text.length >= MIN_FULL_TEXT_CHARS
    ? { ok: true, text, sourceUrl: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${pmcDigits}/`, kind: 'pmc' }
    : { ok: false, reason: 'pmc_too_short' };
}

async function fetchPdfFullText(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ATLAS-MD/1.0)' },
    });
  } catch (err) {
    return { ok: false, reason: 'fetch_failed: ' + err.message.slice(0, 60) };
  }
  if (!res.ok) return { ok: false, reason: 'http_' + res.status };

  const buf = Buffer.from(await res.arrayBuffer());
  // Trust the magic bytes, not the declared content type — publishers label
  // interstitial HTML pages as PDF links all the time.
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, reason: 'not_a_pdf' };
  }

  let parser;
  try {
    parser = new PDFParse({ data: new Uint8Array(buf) });
    const parsed = await parser.getText();
    const text = parsed.text || '';
    return text.length >= MIN_FULL_TEXT_CHARS
      ? { ok: true, text, sourceUrl: url, kind: 'pdf' }
      : { ok: false, reason: 'pdf_cover_sheet_or_too_short' };
  } catch (err) {
    return { ok: false, reason: 'pdf_parse_failed: ' + err.message.slice(0, 60) };
  } finally {
    try { await parser?.destroy(); } catch { /* parser already torn down */ }
  }
}

export async function fetchDocumentText(paper) {
  const pmcId = extractPmcId(paper);
  if (pmcId) {
    try {
      const viaPmc = await fetchPmcFullText(pmcId);
      if (viaPmc.ok) return viaPmc;
    } catch { /* fall through to the PDF route */ }
  }

  const pdfUrl = paper?.openAccessPdf?.url;
  if (pdfUrl) return fetchPdfFullText(pdfUrl);

  return { ok: false, reason: pmcId ? 'pmc_unavailable' : 'no_full_text_source' };
}

// --- 2. Chunk -------------------------------------------------------------

export function chunkText(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  if (text.trim().length < 500) return [];

  // Track section headings line by line, then slice the cleaned body by offset.
  const marks = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    // JATS gives us real headings; PDFs only give us a guess.
    const explicit = line.match(/^##\s+(.{2,80})$/);
    const guessed = explicit ? null : line.match(SECTION_RE);
    if (explicit) marks.push({ at: offset, section: explicit[1].toLowerCase() });
    else if (guessed) marks.push({ at: offset, section: guessed[1].toLowerCase() });
    offset += line.length + 1;
  }
  const sectionAt = (pos) => {
    let s = 'body';
    for (const mk of marks) { if (mk.at <= pos) s = mk.section; else break; }
    return s;
  };

  const chunks = [];
  for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS; i += CHUNK_CHARS - CHUNK_OVERLAP) {
    let slice = text.slice(i, i + CHUNK_CHARS);
    // Prefer to end on a sentence boundary so passages read as prose.
    if (i + CHUNK_CHARS < text.length) {
      const cut = slice.lastIndexOf('. ');
      if (cut > CHUNK_CHARS * 0.6) slice = slice.slice(0, cut + 1);
    }
    const clean = slice.replace(/\s+/g, ' ').trim();
    if (clean.length > 120) chunks.push({ text: clean, section: sectionAt(i) });
  }
  return chunks;
}

// --- 3. Embed -------------------------------------------------------------

// The embedding endpoint enforces a per-minute ceiling. Indexing a whole paper
// in one burst trips it, so batches are retried on the server's own schedule
// rather than failing the index outright.
async function embedSlice(slice, key, taskType, attempts = 4) {
  const body = {
    requests: slice.map((t) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: t }] },
      outputDimensionality: EMBED_DIMS,
      taskType,
    })),
  };

  let lastMsg = 'unknown error';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }
    );
    const json = await res.json();
    if (!json.error) return (json.embeddings || []).map((e) => e.values || []);

    lastMsg = json.error.message || 'unknown error';
    const retryable = [429, 500, 503].includes(json.error.code);
    if (!retryable || attempt === attempts - 1) break;

    const advised = Number(lastMsg.match(/retry in (\d+(?:\.\d+)?)s/)?.[1]);
    const delay = Math.min(Math.max((advised || 2 ** attempt) * 1000 + 500, 1500), 30000);
    console.warn(`[rag] embedding ${json.error.code}, retrying in ${Math.round(delay)}ms`);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`embedding failed: ${lastMsg.slice(0, 120)}`);
}

async function embedBatch(texts, req, taskType) {
  const key = resolveKey(req);
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400)); // stay under the per-minute ceiling
    out.push(...(await embedSlice(texts.slice(i, i + BATCH_SIZE), key, taskType)));
  }
  return out;
}

// Embeddings are compared by dot product, so normalise once at write time
// rather than dividing by magnitudes on every query.
function normalise(vec) {
  let mag = 0;
  for (const v of vec) mag += v * v;
  mag = Math.sqrt(mag) || 1;
  return Float32Array.from(vec, (v) => v / mag);
}

const toBlob = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
const fromBlob = (buf) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

// --- 4. Index -------------------------------------------------------------

export function getPaperStatus(paperId) {
  return db.prepare('SELECT * FROM paper_documents WHERE paper_id = ?').get(paperId) || null;
}

export async function indexPaper(paper, req) {
  const paperId = paper?.paperId;
  if (!paperId) throw new Error('paperId is required');

  const existing = getPaperStatus(paperId);
  if (existing?.status === 'indexed') {
    return { status: 'indexed', chunkCount: existing.chunk_count, cached: true, sourceUrl: existing.source_url };
  }

  const doc = await fetchDocumentText(paper);
  if (!doc.ok) {
    db.prepare(`INSERT INTO paper_documents (paper_id, source_url, status, char_count, chunk_count)
                VALUES (?, ?, 'unavailable', 0, 0)
                ON CONFLICT(paper_id) DO UPDATE SET status='unavailable'`)
      .run(paperId, paper?.openAccessPdf?.url || null);
    return { status: 'unavailable', reason: doc.reason, chunkCount: 0 };
  }

  const chunks = chunkText(doc.text);
  if (chunks.length < 6) {
    db.prepare(`INSERT INTO paper_documents (paper_id, source_url, status, char_count, chunk_count)
                VALUES (?, ?, 'unavailable', ?, 0)
                ON CONFLICT(paper_id) DO UPDATE SET status='unavailable'`)
      .run(paperId, doc.sourceUrl, doc.text.length);
    return { status: 'unavailable', reason: 'no_usable_text', chunkCount: 0 };
  }

  const vectors = await embedBatch(chunks.map((c) => c.text), req, 'RETRIEVAL_DOCUMENT');

  const insert = db.prepare(
    'INSERT INTO paper_chunks (paper_id, chunk_index, section, text, embedding) VALUES (?, ?, ?, ?, ?)'
  );
  const write = db.transaction(() => {
    db.prepare('DELETE FROM paper_chunks WHERE paper_id = ?').run(paperId);
    chunks.forEach((c, i) => {
      if (!vectors[i]?.length) return;
      insert.run(paperId, i, c.section, c.text, toBlob(normalise(vectors[i])));
    });
    db.prepare(`INSERT INTO paper_documents (paper_id, source_url, status, char_count, chunk_count)
                VALUES (?, ?, 'indexed', ?, ?)
                ON CONFLICT(paper_id) DO UPDATE SET
                  source_url=excluded.source_url, status='indexed',
                  char_count=excluded.char_count, chunk_count=excluded.chunk_count`)
      .run(paperId, doc.sourceUrl, doc.text.length, chunks.length);
  });
  write();

  return { status: 'indexed', chunkCount: chunks.length, charCount: doc.text.length, kind: doc.kind, sourceUrl: doc.sourceUrl };
}

// --- 5. Retrieve ----------------------------------------------------------

export async function retrieve(paperId, query, req, k = 6) {
  const rows = db.prepare('SELECT chunk_index, section, text, embedding FROM paper_chunks WHERE paper_id = ?').all(paperId);
  if (!rows.length) return [];

  const [queryVec] = await embedBatch([query], req, 'RETRIEVAL_QUERY');
  if (!queryVec?.length) return [];
  const q = normalise(queryVec);

  // Brute-force dot product. At a few hundred chunks this is sub-millisecond,
  // so a vector index would be dependency weight for no measurable gain.
  return rows
    .map((r) => {
      const v = fromBlob(r.embedding);
      let score = 0;
      for (let i = 0; i < q.length && i < v.length; i++) score += q[i] * v[i];
      return { chunkIndex: r.chunk_index, section: r.section, text: r.text, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
