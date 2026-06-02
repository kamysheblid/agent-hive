import { describe, it, expect } from 'bun:test';
import { buildProfileAnalysisPrompt, parseProfileAnalysisResponse } from '../profile-prompt.js';

describe('buildProfileAnalysisPrompt', () => {
  it('should build prompt with messages', () => {
    const messages = ['I prefer using async/await', 'TypeScript is my favorite'];
    const result = buildProfileAnalysisPrompt(messages);

    expect(result.systemPrompt).toContain('user profiling assistant');
    expect(result.systemPrompt).toContain('preferences');
    expect(result.userPrompt).toContain('I prefer using async/await');
    expect(result.userPrompt).toContain('TypeScript is my favorite');
  });

  it('should truncate long messages to 500 chars', () => {
    const longMsg = 'x'.repeat(1000);
    const messages = [longMsg];
    const result = buildProfileAnalysisPrompt(messages);

    // Message should be in prompt but truncated
    expect(result.userPrompt).toContain('x'.repeat(500));
    expect(result.userPrompt).not.toContain('x'.repeat(1000));
  });

  it('should handle empty messages array', () => {
    const result = buildProfileAnalysisPrompt([]);
    expect(result.systemPrompt).toBeTruthy();
    expect(result.userPrompt).toContain('Analyze these user messages');
  });

  it('should limit total prompt to ~6000 chars per message', () => {
    const messages = Array(20).fill('A short message');
    const result = buildProfileAnalysisPrompt(messages);
    // Should not include all 20 messages (truncated at 6000 chars)
    expect(result.userPrompt.length).toBeLessThan(7000);
  });
});

describe('parseProfileAnalysisResponse', () => {
  it('should parse valid JSON response', () => {
    const response = JSON.stringify({
      preferences: [
        { key: 'code_style', value: 'prefers async/await', confidence: 0.9, category: 'code-style' },
        { key: 'tool_preference', value: 'prefers bun', confidence: 0.7, category: 'tool' },
      ],
      detected_patterns: ['uses TypeScript', 'functional style'],
    });

    const result = parseProfileAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.preferences).toHaveLength(2);
    expect(result!.preferences[0].key).toBe('code_style');
    expect(result!.preferences[0].confidence).toBe(0.9);
    expect(result!.detected_patterns).toHaveLength(2);
  });

  it('should parse JSON from markdown code block', () => {
    const response = 'Here is the analysis:\n```json\n{"preferences": [{"key": "style", "value": "clean code", "confidence": 0.8, "category": "code-style"}], "detected_patterns": ["TDD"]}\n```';
    const result = parseProfileAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.preferences).toHaveLength(1);
    expect(result!.preferences[0].key).toBe('style');
    expect(result!.detected_patterns).toContain('TDD');
  });

  it('should filter out invalid preferences (missing fields)', () => {
    const response = JSON.stringify({
      preferences: [
        { key: 'valid', value: 'yes', confidence: 0.8, category: 'code-style' },
        { key: 'no_value', confidence: 0.8, category: 'code-style' },        // missing value
        { key: 'wrong_type', value: 'yes', confidence: 'high', category: 'code-style' }, // confidence not number
        { missing_key: true, value: 'yes', confidence: 0.8, category: 'code-style' },    // missing key
      ],
      detected_patterns: ['pattern1'],
    });

    const result = parseProfileAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.preferences).toHaveLength(1); // Only valid one
    expect(result!.preferences[0].key).toBe('valid');
  });

  it('should return null for non-JSON response without code block', () => {
    const result = parseProfileAnalysisResponse('This is not JSON at all');
    expect(result).toBeNull();
  });

  it('should return null when preferences array is missing', () => {
    const response = JSON.stringify({ detected_patterns: ['test'] });
    const result = parseProfileAnalysisResponse(response);
    expect(result).toBeNull();
  });

  it('should handle empty preferences', () => {
    const response = JSON.stringify({ preferences: [], detected_patterns: [] });
    const result = parseProfileAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.preferences).toHaveLength(0);
    expect(result!.detected_patterns).toHaveLength(0);
  });

  it('should handle malformed JSON in code block', () => {
    const response = '```json\n{invalid json}\n```';
    const result = parseProfileAnalysisResponse(response);
    expect(result).toBeNull();
  });
});
