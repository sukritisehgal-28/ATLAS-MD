import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'http';

// Test auth endpoints
describe('Auth API', () => {
  let server, baseUrl;

  beforeAll(async () => {
    // We test against actual server to keep it simple
    // In real tests you'd mock the DB
    baseUrl = 'http://localhost:3001/api';
  });

  describe('POST /api/auth/register', () => {
    it('should reject missing fields', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    it('should reject short passwords', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', password: '123', name: 'Test' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('8 characters');
    });

    it('should reject invalid email format', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'notanemail', password: 'password123', name: 'Test' }),
      });
      expect(res.status).toBe(400);
    });

    it('should register a new user successfully', async () => {
      const email = `test-${Date.now()}@test.com`;
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Test User' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeTruthy();
      expect(data.user.email).toBe(email);
      expect(data.user.name).toBe('Test User');
    });

    it('should reject duplicate email', async () => {
      const email = `dup-${Date.now()}@test.com`;
      // Register first time
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Test' }),
      });
      // Try again
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Test' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    const email = `login-test-${Date.now()}@test.com`;

    beforeAll(async () => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Login Test' }),
      });
    });

    it('should login with correct credentials', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeTruthy();
      expect(data.user.email).toBe(email);
    });

    it('should reject wrong password', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrongpassword' }),
      });
      expect(res.status).toBe(401);
    });

    it('should reject non-existent email', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@test.com', password: 'password123' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/verify', () => {
    it('should verify a valid token', async () => {
      const email = `verify-${Date.now()}@test.com`;
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Verify Test' }),
      });
      const { token } = await regRes.json();

      const res = await fetch(`${baseUrl}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.email).toBe(email);
    });

    it('should reject invalid token', async () => {
      const res = await fetch(`${baseUrl}/auth/verify`, {
        headers: { 'Authorization': 'Bearer invalid.token.here' },
      });
      expect(res.status).toBe(401);
    });

    it('should reject missing token', async () => {
      const res = await fetch(`${baseUrl}/auth/verify`);
      expect(res.status).toBe(401);
    });
  });
});
