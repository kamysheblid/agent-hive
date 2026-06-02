import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { OpenCodeProviderService } from '../opencode-provider.js';

describe('OpenCodeProviderService', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      session: {
        prompt: vi.fn(),
      },
    };
  });

  describe('generateStructured', () => {
    it('should parse JSON response from session.prompt', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{ text: '{"summary": "test", "count": 42}' }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.generateStructured<{ summary: string; count: number }>({
        systemPrompt: 'Be helpful',
        userPrompt: 'Extract data',
        expectedFields: ['summary', 'count'],
      });

      expect(result).not.toBeNull();
      expect(result?.summary).toBe('test');
      expect(result?.count).toBe(42);
    });

    it('should return null when client.session.prompt is unavailable', async () => {
      const service = new OpenCodeProviderService({});
      const result = await service.generateStructured({
        systemPrompt: 'test',
        userPrompt: 'test',
      });
      expect(result).toBeNull();
    });

    it('should return null on JSON parse failure', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{ text: 'Not JSON at all' }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.generateStructured({
        systemPrompt: 'test',
        userPrompt: 'test',
        expectedFields: ['summary'],
      });
      expect(result).toBeNull();
    });

    it('should return null when expected fields are missing', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{ text: '{"summary": "hello"}' }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.generateStructured({
        systemPrompt: 'test',
        userPrompt: 'test',
        expectedFields: ['summary', 'missingField'],
      });
      expect(result).toBeNull();
    });

    it('should handle session.prompt rejection gracefully', async () => {
      mockClient.session.prompt.mockRejectedValue(new Error('Provider not available'));

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.generateStructured({
        systemPrompt: 'test',
        userPrompt: 'test',
      });
      expect(result).toBeNull();
    });

    it('should extract JSON from markdown code block', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{
            text: 'Here is the result:\n```json\n{"key": "value", "number": 123}\n```',
          }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.generateStructured<{ key: string; number: number }>({
        systemPrompt: 'test',
        userPrompt: 'test',
        expectedFields: ['key', 'number'],
      });

      expect(result).not.toBeNull();
      expect(result?.key).toBe('value');
      expect(result?.number).toBe(123);
    });
  });

  describe('isAvailable', () => {
    it('should return true when provider responds with status ok', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{ text: '{"status": "ok"}' }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const available = await service.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when provider responds with wrong status', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{ text: '{"status": "error"}' }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });

    it('should return false when client unavailable', async () => {
      const service = new OpenCodeProviderService({});
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });

    it('should return false on rejection', async () => {
      mockClient.session.prompt.mockRejectedValue(new Error('down'));

      const service = new OpenCodeProviderService(mockClient);
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('captureStructuredMemory', () => {
    it('should format structured memory from session context', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{
            text: JSON.stringify({
              summary: 'Worked on authentication',
              key_decisions: ['Use JWT'],
              key_learnings: ['Rate limit at 100/min'],
              active_tasks: ['Add refresh token'],
              tags: ['auth', 'security'],
            }),
          }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.captureStructuredMemory('Session context here...');

      expect(result).not.toBeNull();
      expect(result).toContain('Worked on authentication');
      expect(result).toContain('Use JWT');
      expect(result).toContain('Rate limit at 100/min');
      expect(result).toContain('auth, security');
    });

    it('should return null when provider returns no summary', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{ text: '{"tags": ["test"]}' }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.captureStructuredMemory('Session context...');
      expect(result).toBeNull();
    });

    it('should return null when client unavailable', async () => {
      const service = new OpenCodeProviderService({});
      const result = await service.captureStructuredMemory('test');
      expect(result).toBeNull();
    });

    it('should handle malformed JSON gracefully', async () => {
      mockClient.session.prompt.mockResolvedValue({
        body: {
          parts: [{ text: 'not json at all and no code blocks' }],
        },
      });

      const service = new OpenCodeProviderService(mockClient);
      const result = await service.captureStructuredMemory('test');
      expect(result).toBeNull();
    });
  });
});
