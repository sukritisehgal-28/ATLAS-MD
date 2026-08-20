import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'atlas.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Sessions for collaborative research
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS session_members (
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, user_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Cross-session memory — AI remembers past research
db.exec(`
  CREATE TABLE IF NOT EXISTS research_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    concepts TEXT,
    paper_count INTEGER DEFAULT 0,
    top_papers TEXT,
    summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Full-text RAG index. Chunks are stored with their embedding so a paper only
// has to be fetched, parsed and embedded once per instance.
db.exec(`
  CREATE TABLE IF NOT EXISTS paper_documents (
    paper_id TEXT PRIMARY KEY,
    source_url TEXT,
    status TEXT NOT NULL,
    char_count INTEGER DEFAULT 0,
    chunk_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS paper_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    section TEXT,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper ON paper_chunks(paper_id)`);

// Seed demo accounts for quick local login.
//
// These credentials are committed to a public repo, so they are development-only.
// Set SEED_DEMO_ACCOUNTS=true to opt in explicitly anywhere else.
import bcryptjs from 'bcryptjs';
import { isProduction } from './config.js';

const seedDemoAccounts = process.env.SEED_DEMO_ACCOUNTS === 'true' || !isProduction;

if (seedDemoAccounts) {
  const demoAccounts = [
    { email: 'demo@atlasmd.live', password: 'demo1234', name: 'Demo User' },
  ];

  for (const acc of demoAccounts) {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(acc.email);
    if (!exists) {
      const hash = bcryptjs.hashSync(acc.password, 10);
      db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(acc.email, hash, acc.name);
    }
  }
}

export default db;
