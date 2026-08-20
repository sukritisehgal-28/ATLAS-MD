// Boots the API server against a throwaway SQLite database so `npm test` works
// from a clean checkout with no manually started server.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, '..', 'server', 'index.js');

const PORT = process.env.TEST_PORT || '3001';
const BASE_URL = `http://127.0.0.1:${PORT}`;

let child;
let dbPath;

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any response at all means the listener is accepting connections.
      await fetch(`${BASE_URL}/api/auth/verify`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Test server did not become ready on ${BASE_URL} within ${timeoutMs}ms`);
}

export async function setup() {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-')), 'test.db');

  child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_PATH: dbPath,
      PORT,
      // The suite deliberately bursts auth requests; keep the limiter out of its way.
      AUTH_RATE_LIMIT: '10000',
      API_RATE_LIMIT: '10000',
    },
    stdio: 'pipe',
  });

  child.stderr.on('data', (d) => process.stderr.write(`[test-server] ${d}`));

  await waitForServer();
}

export async function teardown() {
  if (child && !child.killed) child.kill('SIGTERM');
  if (dbPath) {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* already gone */ }
    }
  }
}
