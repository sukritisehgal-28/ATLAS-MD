import { describe, it, expect, beforeAll } from 'vitest';

describe('Protected API Routes', () => {
  let token, baseUrl;

  beforeAll(async () => {
    baseUrl = 'http://localhost:3001/api';
    const email = `api-test-${Date.now()}@test.com`;
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'API Test' }),
    });
    const data = await res.json();
    token = data.token;
  });

  it('should reject unauthenticated requests', async () => {
    const res = await fetch(`${baseUrl}/extract-concepts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'test' }),
    });
    expect(res.status).toBe(401);
  });

  it('should accept authenticated requests to extract-concepts', async () => {
    const res = await fetch(`${baseUrl}/extract-concepts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ description: 'diabetes type 2' }),
    });
    // May fail if Gemini key is missing, but should not be 401
    expect(res.status).not.toBe(401);
  });

  describe('Sessions', () => {
    it('should create a session', async () => {
      const res = await fetch(`${baseUrl}/sessions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name: 'Test Session' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessionId).toBeTruthy();
      expect(data.name).toBe('Test Session');
    });

    it('should list user sessions', async () => {
      const res = await fetch(`${baseUrl}/sessions`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it('should join an existing session', async () => {
      // Create first
      const createRes = await fetch(`${baseUrl}/sessions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name: 'Join Test' }),
      });
      const { sessionId } = await createRes.json();

      const res = await fetch(`${baseUrl}/sessions/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId }),
      });
      expect(res.status).toBe(200);
    });

    it('should reject joining non-existent session', async () => {
      const res = await fetch(`${baseUrl}/sessions/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId: 'zzzzzz' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Research Memory', () => {
    it('should save research memory', async () => {
      const res = await fetch(`${baseUrl}/memory/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: 'test query',
          concepts: ['concept1'],
          paperCount: 5,
          topPapers: [{ title: 'Test Paper', year: 2024 }],
          summary: 'Test summary',
        }),
      });
      expect(res.status).toBe(200);
    });

    it('should retrieve research memory', async () => {
      const res = await fetch(`${baseUrl}/memory`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.memories)).toBe(true);
    });
  });
});
