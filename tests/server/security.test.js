import { describe, it, expect, beforeAll } from 'vitest';

describe('Security Tests', () => {
  const baseUrl = 'http://localhost:3001/api';

  describe('Input Validation', () => {
    it('should reject name longer than 100 chars', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `long-${Date.now()}@test.com`,
          password: 'password123',
          name: 'A'.repeat(101),
        }),
      });
      expect(res.status).toBe(400);
    });

    it('should normalize email to lowercase', async () => {
      const email = `UPPER-${Date.now()}@TEST.COM`;
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Test' }),
      });
      const data = await res.json();
      expect(data.user.email).toBe(email.toLowerCase());
    });
  });

  describe('Authentication', () => {
    it('should not expose password hash in responses', async () => {
      const email = `hash-${Date.now()}@test.com`;
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Test' }),
      });
      const data = await res.json();
      expect(data.user.password_hash).toBeUndefined();
      expect(data.user.password).toBeUndefined();
    });

    it('should return same error for wrong email and wrong password', async () => {
      const wrongEmailRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nope@test.com', password: 'password123' }),
      });
      const wrongEmailData = await wrongEmailRes.json();

      const email = `enum-${Date.now()}@test.com`;
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Test' }),
      });
      const wrongPassRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrongpassword' }),
      });
      const wrongPassData = await wrongPassRes.json();

      // Same generic error to prevent user enumeration
      expect(wrongEmailData.error).toBe(wrongPassData.error);
    });
  });

  describe('Session Security', () => {
    it('should truncate session name to 100 chars', async () => {
      const email = `sess-${Date.now()}@test.com`;
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Test' }),
      });
      const { token } = await regRes.json();

      const longName = 'X'.repeat(200);
      const res = await fetch(`${baseUrl}/sessions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name: longName }),
      });
      const data = await res.json();
      expect(data.name.length).toBeLessThanOrEqual(100);
    });
  });
});
