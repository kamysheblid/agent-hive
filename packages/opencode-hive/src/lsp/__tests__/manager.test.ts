import { describe, test, expect, beforeEach, vi, afterEach } from 'bun:test';
import { LspManager } from '../manager.js';
import type { LspClient } from '../client.js';

// Mock the LspClient constructor
vi.mock('../client.js', () => {
  let clientCount = 0;
  return {
    LspClient: vi.fn().mockImplementation((transport: any) => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      serverCapabilities: {},
      initialized: false,
      pid: ++clientCount,
    })),
  };
});

// Mock LspTransport
vi.mock('../transport.js', () => ({
  LspTransport: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    close: vi.fn(),
    process: { pid: 12345, stdin: { write: vi.fn() } },
  })),
}));

describe('LspManager', () => {
  let manager: LspManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new LspManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getClient', () => {
    test('creates a new client for a workspace and server', async () => {
      const client = await manager.getClient('/test/workspace', 'typescript');
      expect(client).toBeDefined();
      expect(client.initialize).toHaveBeenCalledWith('/test/workspace');
    });

    test('returns same client for same workspace and server', async () => {
      const client1 = await manager.getClient('/test/workspace', 'typescript');
      const client2 = await manager.getClient('/test/workspace', 'typescript');
      expect(client1).toBe(client2);
    });

    test('creates different clients for different workspaces', async () => {
      const client1 = await manager.getClient('/workspace/a', 'typescript');
      const client2 = await manager.getClient('/workspace/b', 'typescript');
      expect(client1).not.toBe(client2);
    });

    test('creates different clients for different servers', async () => {
      const client1 = await manager.getClient('/test/workspace', 'typescript');
      const client2 = await manager.getClient('/test/workspace', 'python');
      expect(client1).not.toBe(client2);
    });

    test('reuses client after release and re-acquire', async () => {
      const client1 = await manager.getClient('/test/workspace', 'typescript');
      manager.releaseClient('/test/workspace::typescript');
      const client2 = await manager.getClient('/test/workspace', 'typescript');
      // After release, a new client should be created
      expect(client2).toBeDefined();
    });
  });

  describe('releaseClient', () => {
    test('removes client from active map', async () => {
      await manager.getClient('/test/workspace', 'typescript');
      manager.releaseClient('/test/workspace::typescript');

      // After release, getting a client should create a new one
      const client = await manager.getClient('/test/workspace', 'typescript');
      expect(client).toBeDefined();
    });

    test('is idempotent for unknown key', () => {
      // Should not throw
      manager.releaseClient('unknown::key');
    });
  });

  describe('idle reaper', () => {
    test('kills clients idle for more than 5 minutes', async () => {
      const client = await manager.getClient('/test/workspace', 'typescript');

      // Advance time by 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Trigger the reaper
      manager.reapIdleClients();

      expect(client.close).toHaveBeenCalled();
    });

    test('does not kill clients idle for less than 5 minutes', async () => {
      const client = await manager.getClient('/test/workspace', 'typescript');

      // Advance time by 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);

      manager.reapIdleClients();

      expect(client.close).not.toHaveBeenCalled();
    });

    test('refreshes last used time on getClient', async () => {
      const client = await manager.getClient('/test/workspace', 'typescript');

      // Advance 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Re-acquire (should refresh timestamp)
      await manager.getClient('/test/workspace', 'typescript');

      // Advance another 4 minutes (total 8, but only 4 since refresh)
      vi.advanceTimersByTime(4 * 60 * 1000);

      manager.reapIdleClients();

      // Client should still be alive
      expect(client.close).not.toHaveBeenCalled();
    });
  });

  describe('getActiveClients', () => {
    test('returns count of active clients', async () => {
      expect(manager.getActiveClients()).toBe(0);

      await manager.getClient('/workspace/a', 'typescript');
      expect(manager.getActiveClients()).toBe(1);

      await manager.getClient('/workspace/b', 'python');
      expect(manager.getActiveClients()).toBe(2);
    });
  });

  describe('shutdownAll', () => {
    test('closes all active clients', async () => {
      const client1 = await manager.getClient('/workspace/a', 'typescript');
      const client2 = await manager.getClient('/workspace/b', 'python');

      await manager.shutdownAll();

      expect(client1.close).toHaveBeenCalled();
      expect(client2.close).toHaveBeenCalled();
      expect(manager.getActiveClients()).toBe(0);
    });
  });

  describe('getClientKey', () => {
    test('generates correct key format', () => {
      const key = LspManager.getClientKey('/test/workspace', 'typescript');
      expect(key).toBe('/test/workspace::typescript');
    });
  });
});
