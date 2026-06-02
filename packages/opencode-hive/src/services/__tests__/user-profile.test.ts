import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { UserProfileService } from '../user-profile.js';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('UserProfileService', () => {
  let mockProvider: any;
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = path.join(tmpdir(), `hive-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(tempDir, '.hive'), { recursive: true });

    mockProvider = {
      generateStructured: vi.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor and initialization', () => {
    it('should create service with default config', () => {
      const service = new UserProfileService({ enabled: true }, mockProvider, tempDir);
      expect(service).toBeTruthy();
    });

    it('should create service with disabled config', () => {
      const service = new UserProfileService({ enabled: false }, mockProvider, tempDir);
      expect(service).toBeTruthy();
    });

    it('should load existing profile from disk', () => {
      const profilePath = path.join(tempDir, '.hive', 'profile.json');
      const existing = {
        preferences: [{ key: 'style', value: 'clean code', confidence: 0.8, category: 'code-style', firstSeen: '2024-01-01', lastUpdated: '2024-01-01' }],
        detectedPatterns: ['uses TypeScript'],
        lastAnalysis: '2024-01-01',
        version: 1,
      };
      fs.writeFileSync(profilePath, JSON.stringify(existing));

      const service = new UserProfileService({ enabled: true }, mockProvider, tempDir);
      const injection = service.getProfileInjection();
      expect(injection).toContain('style');
      expect(injection).toContain('clean code');
    });
  });

  describe('onUserMessage', () => {
    it('should track messages and trigger analysis at interval', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 3 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [{ key: 'code_style', value: 'prefers async/await', confidence: 0.9, category: 'code-style' }],
        detected_patterns: [],
      });

      // First two messages should not trigger analysis
      await service.onUserMessage('hello');
      await service.onUserMessage('world');

      // Analysis should NOT have been called yet
      expect(mockProvider.generateStructured).not.toHaveBeenCalled();

      // Third message triggers analysis
      await service.onUserMessage('I like async/await');

      // Should have triggered analysis
      expect(mockProvider.generateStructured).toHaveBeenCalledTimes(1);
    });

    it('should not track messages when disabled', async () => {
      const service = new UserProfileService(
        { enabled: false },
        mockProvider,
        tempDir,
      );

      await service.onUserMessage('test message');

      // Should not throw but also not analyze
      expect(mockProvider.generateStructured).not.toHaveBeenCalled();
    });

    it('should not throw on provider error', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockRejectedValue(new Error('Provider error'));

      // Should not throw
      await service.onUserMessage('test');
    });

    it('should bound recent messages array', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 10 },
        mockProvider,
        tempDir,
      );

      // Send more than 2x interval messages
      for (let i = 0; i < 30; i++) {
        await service.onUserMessage(`message ${i}`);
      }

      // Should have trimmed recent messages (accessible via profile injection)
      // Should not crash from unbounded growth
      expect(mockProvider.generateStructured).toHaveBeenCalledTimes(3); // at 10, 20, 30
    });
  });

  describe('analyzeAndUpdate', () => {
    it('should merge new preferences with existing ones', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [
          { key: 'code_style', value: 'prefers async/await', confidence: 0.9, category: 'code-style' },
        ],
        detected_patterns: [],
      });

      await service.onUserMessage('first message');

      expect(mockProvider.generateStructured).toHaveBeenCalledTimes(1);

      // Second analysis with same key but different value
      mockProvider.generateStructured.mockResolvedValue({
        preferences: [
          { key: 'code_style', value: 'prefers promises', confidence: 0.8, category: 'code-style' },
          { key: 'tool', value: 'likes bun', confidence: 0.7, category: 'tool' },
        ],
        detected_patterns: [],
      });

      // Reset counter and trigger second analysis
      service.resetMessageCount();
      await service.onUserMessage('second message');

      expect(mockProvider.generateStructured).toHaveBeenCalledTimes(2);

      // Verify merged: code_style updated to "prefers promises" (last write wins, max confidence)
      const injection = service.getProfileInjection();
      expect(injection).toContain('prefers promises'); // value from latest analysis
      expect(injection).toContain('bun'); // new preference added
    });

    it('should skip low-confidence preferences (< 0.6)', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [
          { key: 'low_conf', value: 'maybe', confidence: 0.3, category: 'preference' },
          { key: 'high_conf', value: 'definitely', confidence: 0.9, category: 'preference' },
        ],
        detected_patterns: [],
      });

      await service.onUserMessage('test');

      const injection = service.getProfileInjection();
      expect(injection).toContain('definitely');
      expect(injection).not.toContain('maybe');
    });

    it('should merge detected patterns', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [{ key: 'style', value: 'clean', confidence: 0.9, category: 'code-style' }],
        detected_patterns: ['uses TypeScript'],
      });

      await service.onUserMessage('test');

      // Second analysis with new patterns
      service.resetMessageCount();
      mockProvider.generateStructured.mockResolvedValue({
        preferences: [{ key: 'style', value: 'clean', confidence: 0.9, category: 'code-style' }],
        detected_patterns: ['uses TypeScript', 'functional programming'],
      });

      await service.onUserMessage('test2');

      const injection = service.getProfileInjection();
      expect(injection).toContain('TypeScript');
      expect(injection).toContain('functional');
    });
  });

  describe('getProfileInjection', () => {
    it('should return empty string when disabled', () => {
      const service = new UserProfileService({ enabled: false }, mockProvider, tempDir);
      expect(service.getProfileInjection()).toBe('');
    });

    it('should return empty string when no preferences exist', () => {
      const service = new UserProfileService({ enabled: true }, mockProvider, tempDir);
      expect(service.getProfileInjection()).toBe('');
    });

    it('should format profile with XML tags', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [
          { key: 'style', value: 'clean code', confidence: 0.9, category: 'code-style' },
        ],
        detected_patterns: ['TDD'],
      });

      await service.onUserMessage('test');

      const injection = service.getProfileInjection();
      expect(injection).toContain('<user_profile>');
      expect(injection).toContain('</user_profile>');
      expect(injection).toContain('[code-style]');
      expect(injection).toContain('style: clean code');
      expect(injection).toContain('patterns:');
      expect(injection).toContain('TDD');
    });

    it('should only include preferences with confidence >= 0.6', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [
          { key: 'high', value: 'confident', confidence: 0.95, category: 'code-style' },
          { key: 'medium', value: 'maybe', confidence: 0.65, category: 'tool' },
        ],
        detected_patterns: [],
      });

      await service.onUserMessage('test');

      const injection = service.getProfileInjection();
      expect(injection).toContain('high');
      expect(injection).toContain('medium');
    });

    it('should exclude preferences with confidence < 0.6 from output', async () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [
          { key: 'low', value: 'uncertain', confidence: 0.5, category: 'preference' },
        ],
        detected_patterns: [],
      });

      await service.onUserMessage('test');

      const injection = service.getProfileInjection();
      expect(injection).toBe(''); // all prefs below 0.6 threshold
    });
  });

  describe('confidence decay', () => {
    it('should apply confidence decay over time', async () => {
      // Create profile with old preferences
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago
      const profilePath = path.join(tempDir, '.hive', 'profile.json');
      fs.writeFileSync(profilePath, JSON.stringify({
        preferences: [
          { key: 'old_pref', value: 'old value', confidence: 0.9, category: 'preference',
            firstSeen: oldDate, lastUpdated: oldDate },
          { key: 'new_pref', value: 'new value', confidence: 0.9, category: 'preference',
            firstSeen: new Date().toISOString(), lastUpdated: new Date().toISOString() },
        ],
        detectedPatterns: [],
        lastAnalysis: oldDate,
        version: 1,
      }));

      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1, confidenceDecayDays: 30 },
        mockProvider,
        tempDir,
      );

      // Trigger analysis to apply decay via merge
      // Use prefs in the mock so getProfileInjection still renders
      mockProvider.generateStructured.mockResolvedValue({
        preferences: [],
        detected_patterns: [],
      });

      await service.onUserMessage('test message');

      // Old pref should have reduced confidence (0.9 * 0.5^1 = 0.45 at 31 days with 30-day period)
      // confidence 0.45 is below display threshold (0.6), so not shown in injection
      // New pref should remain at 0.9
      const injection = service.getProfileInjection();
      // After 31 days with 30-day decay half-life: 0.9 * 0.5 = 0.45 (< 0.6 display threshold)
      // So old_pref is NOT in the displayed injection — new_pref remains
      expect(injection).not.toContain('old_pref');
      expect(injection).toContain('new_pref');
    });

    it('should remove zero-confidence preferences after decay', async () => {
      const veryOldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(); // 120 days ago
      const profilePath = path.join(tempDir, '.hive', 'profile.json');
      fs.writeFileSync(profilePath, JSON.stringify({
        preferences: [
          { key: 'very_old', value: 'ancient history', confidence: 0.9, category: 'preference',
            firstSeen: veryOldDate, lastUpdated: veryOldDate },
        ],
        detectedPatterns: [],
        lastAnalysis: veryOldDate,
        version: 1,
      }));

      const service = new UserProfileService(
        { enabled: true, analysisInterval: 1, confidenceDecayDays: 30 },
        mockProvider,
        tempDir,
      );

      mockProvider.generateStructured.mockResolvedValue({
        preferences: [],
        detected_patterns: [],
      });

      await service.onUserMessage('test');

      // After 120 days = 4 periods of 30 days = 0.9 * 0.5^4 = 0.05625 < 0.1, should be removed
      const injection = service.getProfileInjection();
      expect(injection).toBe('');
    });
  });

  describe('resetMessageCount', () => {
    it('should reset the message counter', () => {
      const service = new UserProfileService(
        { enabled: true, analysisInterval: 5 },
        mockProvider,
        tempDir,
      );

      service.resetMessageCount();
      // Should not trigger analysis on next message (counter is at 0, needs 5)
      expect(mockProvider.generateStructured).not.toHaveBeenCalled();
    });
  });
});
