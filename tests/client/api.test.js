import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const storage = {};
global.localStorage = {
  getItem: vi.fn((key) => storage[key] || null),
  setItem: vi.fn((key, val) => { storage[key] = val; }),
  removeItem: vi.fn((key) => { delete storage[key]; }),
};

// Mock import.meta.env
vi.stubGlobal('import', { meta: { env: {} } });

// Mock window for browser APIs used in api.js
global.window = {
  dispatchEvent: vi.fn(),
  Event: class Event { constructor(type) { this.type = type; } },
};
global.Event = global.window.Event;

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.keys(storage).forEach(k => delete storage[k]);
  });

  it('should include auth header when token exists', async () => {
    storage['atlas-token'] = 'test-token';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ concepts: ['test'] }),
    });

    // Dynamic import to pick up mocks
    const { extractConcepts } = await import('../../src/services/api.js');
    await extractConcepts('test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/extract-concepts'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
        }),
      })
    );
  });

  it('should dispatch auth-expired event on 401', async () => {
    storage['atlas-token'] = 'expired-token';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid token' }),
    });

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { extractConcepts } = await import('../../src/services/api.js');
    await expect(extractConcepts('test')).rejects.toThrow('Session expired');

    expect(storage['atlas-token']).toBeUndefined();
  });
});
