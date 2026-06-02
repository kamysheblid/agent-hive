import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { reInjectMemoriesAfterCompact } from '../compaction-restoration.js';

// Mock vector-memory service — tested separately, so just mock its results
vi.mock('../../services/vector-memory.js', () => ({
  searchMemories: vi.fn(),
}));

import { searchMemories } from '../../services/vector-memory.js';

describe('compaction-restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reInjectMemoriesAfterCompact', () => {
    it('should skip when disabled in config', async () => {
      const client = { session: { prompt: vi.fn() } };
      
      await reInjectMemoriesAfterCompact('session-1', client, { enabled: false });
      
      expect(searchMemories).not.toHaveBeenCalled();
    });

    it('should skip silently when no memories found', async () => {
      const client = { session: { prompt: vi.fn() } };
      (searchMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ results: [] });
      
      await reInjectMemoriesAfterCompact('session-1', client, { enabled: true, maxMemories: 5 });
      
      expect(client.session.prompt).not.toHaveBeenCalled();
    });

    it('should inject memories via session.prompt when memories exist', async () => {
      const client = {
        session: {
          prompt: vi.fn().mockResolvedValue(undefined),
        },
        tui: {
          showToast: vi.fn().mockResolvedValue(undefined),
        },
      };
      
      const mockMemories = [
        { type: 'decision', scope: 'auth', content: 'Use JWT with refresh tokens' },
        { type: 'learning', scope: 'api', content: 'Rate limiting at 100 req/min' },
      ];
      (searchMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ results: mockMemories });

      await reInjectMemoriesAfterCompact('session-1', client, { enabled: true, maxMemories: 5 });

      expect(searchMemories).toHaveBeenCalledWith({ limit: 5 });
      expect(client.session.prompt).toHaveBeenCalledTimes(1);
      
      const callArg = client.session.prompt.mock.calls[0][0];
      expect(callArg.path.id).toBe('session-1');
      expect(callArg.body.noReply).toBe(true);
      expect(callArg.body.parts[0].synthetic).toBe(true);
      expect(callArg.body.parts[0].text).toContain('<persistent_memory>');
      expect(callArg.body.parts[0].text).toContain('JWT');
      expect(callArg.body.parts[0].text).toContain('Rate limiting');

      // Toast should be shown
      expect(client.tui.showToast).toHaveBeenCalledTimes(1);
      expect(client.tui.showToast.mock.calls[0][0].body.variant).toBe('info');
    });

    it('should not crash when session.prompt is unavailable', async () => {
      const client = {}; // no session.prompt at all
      const mockMemories = [
        { type: 'context', content: 'Some memory' },
      ];
      (searchMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ results: mockMemories });

      // Should not throw
      await expect(
        reInjectMemoriesAfterCompact('session-1', client, { enabled: true }),
      ).resolves.toBeUndefined();
    });

    it('should not crash when session.prompt rejects', async () => {
      const client = {
        session: {
          prompt: vi.fn().mockRejectedValue(new Error('session closed')),
        },
      };
      const mockMemories = [
        { type: 'context', content: 'Some memory' },
      ];
      (searchMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ results: mockMemories });

      await expect(
        reInjectMemoriesAfterCompact('session-1', client, { enabled: true }),
      ).resolves.toBeUndefined();
    });

    it('should handle searchMemories failure gracefully', async () => {
      const client = { session: { prompt: vi.fn() } };
      (searchMemories as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db locked'));

      await expect(
        reInjectMemoriesAfterCompact('session-1', client, { enabled: true }),
      ).resolves.toBeUndefined();
    });

    it('should use default maxMemories of 5 when config not provided', async () => {
      const client = { session: { prompt: vi.fn() } };
      (searchMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ results: [] });

      await reInjectMemoriesAfterCompact('session-1', client, undefined);

      expect(searchMemories).toHaveBeenCalledWith({ limit: 5 });
    });
  });
});
