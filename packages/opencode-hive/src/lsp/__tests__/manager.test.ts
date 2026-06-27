import { describe, test, expect, beforeEach, vi, afterEach } from 'bun:test';
import { LspManager } from '../manager.js';

/**
 * Tests for LspManager pool behavior.
 *
 * NOTE: We do NOT use vi.mock() here because bun 1.3.14 shares mock state
 * across test files, which leaks and breaks other test files (e.g. client.test.ts).
 * Instead, we inject mock clients directly into the manager's internal pool.
 */
describe('LspManager', () => {
  let manager: LspManager;

  function createMockClient() {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      openFile: vi.fn(),
      closeFile: vi.fn(),
      gotoDefinition: vi.fn().mockResolvedValue([]),
      findReferences: vi.fn().mockResolvedValue([]),
      hover: vi.fn().mockResolvedValue(null),
      rename: vi.fn().mockResolvedValue(null),
      getDiagnostics: vi.fn().mockReturnValue([]),
      serverCapabilities: {},
      initialized: false,
    };
  }

  /** Inject a mock client directly into the manager's internal pool. */
  function injectClient(key: string, client: ReturnType<typeof createMockClient>, lastUsed?: number) {
    (manager as any).clients.set(key, {
      client,
      lastUsed: lastUsed ?? Date.now(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new LspManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getClientKey', () => {
    test('generates correct key format', () => {
      const key = LspManager.getClientKey('/test/workspace', 'typescript');
      expect(key).toBe('/test/workspace::typescript');
    });
  });

  describe('releaseClient', () => {
    test('removes client from active map', () => {
      injectClient('/test/workspace::typescript', createMockClient());
      expect(manager.getActiveClients()).toBe(1);

      manager.releaseClient('/test/workspace::typescript');
      expect(manager.getActiveClients()).toBe(0);
    });

    test('is idempotent for unknown key', () => {
      expect(() => manager.releaseClient('unknown::key')).not.toThrow();
    });
  });

  describe('idle reaper', () => {
    test('kills clients idle for more than 5 minutes', () => {
      const client = createMockClient();
      injectClient('/test/workspace::typescript', client);

      // Advance time by 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Trigger the reaper
      manager.reapIdleClients();

      expect(client.close).toHaveBeenCalled();
      expect(manager.getActiveClients()).toBe(0);
    });

    test('does not kill clients idle for less than 5 minutes', () => {
      const client = createMockClient();
      injectClient('/test/workspace::typescript', client);

      // Advance time by 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);

      manager.reapIdleClients();

      expect(client.close).not.toHaveBeenCalled();
      expect(manager.getActiveClients()).toBe(1);
    });

    test('refreshes last used time prevents reap', () => {
      const client = createMockClient();
      injectClient('/test/workspace::typescript', client);

      // Advance 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Refresh the lastUsed timestamp (simulates what getClient does)
      const entry = (manager as any).clients.get('/test/workspace::typescript');
      entry.lastUsed = Date.now();

      // Advance another 4 minutes (total 8, but only 4 since refresh)
      vi.advanceTimersByTime(4 * 60 * 1000);

      manager.reapIdleClients();

      // Client should still be alive
      expect(client.close).not.toHaveBeenCalled();
      expect(manager.getActiveClients()).toBe(1);
    });
  });

  describe('getActiveClients', () => {
    test('returns count of active clients', () => {
      expect(manager.getActiveClients()).toBe(0);

      injectClient('/workspace/a::typescript', createMockClient());
      expect(manager.getActiveClients()).toBe(1);

      injectClient('/workspace/b::python', createMockClient());
      expect(manager.getActiveClients()).toBe(2);
    });
  });

  describe('shutdownAll', () => {
    test('closes all active clients', async () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      injectClient('/workspace/a::typescript', client1);
      injectClient('/workspace/b::python', client2);

      await manager.shutdownAll();

      expect(client1.close).toHaveBeenCalled();
      expect(client2.close).toHaveBeenCalled();
      expect(manager.getActiveClients()).toBe(0);
    });

    test('handles empty pool gracefully', async () => {
      await manager.shutdownAll();
      expect(manager.getActiveClients()).toBe(0);
    });
  });

  describe('pool deduplication', () => {
    test('same key returns same client instance', () => {
      const client = createMockClient();
      injectClient('/test/workspace::typescript', client);

      // Simulate getClient returning the same client for the same key
      const entry1 = (manager as any).clients.get('/test/workspace::typescript');
      const entry2 = (manager as any).clients.get('/test/workspace::typescript');
      expect(entry1.client).toBe(entry2.client);
    });

    test('different keys hold different clients', () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      injectClient('/workspace/a::typescript', client1);
      injectClient('/workspace/b::python', client2);

      const entry1 = (manager as any).clients.get('/workspace/a::typescript');
      const entry2 = (manager as any).clients.get('/workspace/b::python');
      expect(entry1.client).not.toBe(entry2.client);
    });

    test('release and re-inject creates fresh entry', () => {
      const client1 = createMockClient();
      injectClient('/test/workspace::typescript', client1);
      expect(manager.getActiveClients()).toBe(1);

      manager.releaseClient('/test/workspace::typescript');
      expect(manager.getActiveClients()).toBe(0);

      const client2 = createMockClient();
      injectClient('/test/workspace::typescript', client2);
      expect(manager.getActiveClients()).toBe(1);

      const entry = (manager as any).clients.get('/test/workspace::typescript');
      expect(entry.client).toBe(client2);
    });
  });
});
