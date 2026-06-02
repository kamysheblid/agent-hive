import { describe, test, expect } from 'bun:test';
import { filterSensitiveData, containsSensitiveData } from './sensitive-data-filter.js';

describe('filterSensitiveData', () => {
  test('passes through normal content unchanged', () => {
    const input = 'This is normal content about async/await patterns.';
    expect(filterSensitiveData(input)).toBe(input);
  });

  test('redacts OpenAI-style API keys (sk-...)', () => {
    const result = filterSensitiveData('my key is sk-proj-abc123def456ghi789jkl');
    expect(result).not.toContain('sk-proj-abc123def456ghi789jkl');
    expect(result).toContain('[API_KEY_REDACTED]');
  });

  test('redacts GitHub tokens (ghp_...)', () => {
    const result = filterSensitiveData('token=ghp_abc123def456ghi789jkl012mno345pqr678');
    expect(result).not.toContain('ghp_abc123def456ghi789jkl012mno345pqr678');
    expect(result).toContain('[GITHUB_TOKEN_REDACTED]');
  });

  test('redacts AWS access keys (AKIA...)', () => {
    const result = filterSensitiveData('aws_access_key_id=AKIAIOSFODNN7EXAMPLE');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('[AWS_KEY_REDACTED]');
  });

  test('redacts AWS secret key assignment', () => {
    const result = filterSensitiveData('aws_secret_access_key=wJalrXUtFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('wJalrXUtFEMI');
  });

  test('redacts private key blocks', () => {
    const input = `some config
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA04Kh+fiKQ2PACQ6WlP0RNa2F
-----END RSA PRIVATE KEY-----
more config`;
    const result = filterSensitiveData(input);
    expect(result).not.toContain('MIIEpAIBAAKCAQEA04Kh');
    expect(result).toContain('[PRIVATE_KEY_REDACTED]');
  });

  test('redacts JWT tokens', () => {
    const result = filterSensitiveData(
      'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwfQ.dB2V_iBgSx4kKq8BJI-5Vw'
    );
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result).toContain('[JWT_REDACTED]');
  });

  test('redacts bearer tokens', () => {
    const result = filterSensitiveData('Authorization: Bearer abc123def456ghi789jkl012mno345pqr678stu901');
    expect(result).toContain('[TOKEN_REDACTED]');
    expect(result).not.toContain('abc123def456ghi');
  });

  test('redacts database connection strings with credentials', () => {
    const result = filterSensitiveData('postgres://admin:supersecret@localhost:5432/db');
    expect(result).not.toContain('supersecret');
  });

  test('redacts sensitive env vars (API_KEY, SECRET, etc.)', () => {
    // No specific key prefix matched — env-var blanket pattern catches it
    const result = filterSensitiveData('SECRET=supersecretvalue123');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('supersecretvalue123');
  });

  test('redacts API keys in env-var format', () => {
    // The specific API key pattern catches first, giving a more specific marker
    const result = filterSensitiveData('API_KEY=sk-test-1234567890abcdef');
    expect(result).toContain('[API_KEY_REDACTED]');
    expect(result).not.toContain('sk-test-1234567890abcdef');
  });

  test('redacts passwords in config', () => {
    const result = filterSensitiveData('password = "mySecretPass123!"');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('mySecretPass123!');
  });

  test('respects enabled: false config', () => {
    const input = 'sk-abc123def456ghi789jkl';
    expect(filterSensitiveData(input, { enabled: false })).toBe(input);
  });

  test('redacts emails when config has redactEmails: true', () => {
    const result = filterSensitiveData('Contact me at test@example.com', {
      redactEmails: true,
    });
    expect(result).not.toContain('test@example.com');
    expect(result).toContain('[EMAIL_REDACTED]');
  });

  test('does NOT redact emails by default', () => {
    const input = 'Contact me at test@example.com';
    expect(filterSensitiveData(input)).toContain('test@example.com');
  });

  test('applies custom patterns from config', () => {
    const result = filterSensitiveData('MY_CUSTOM_KEY_12345', {
      customPatterns: [{ name: 'custom-key', pattern: 'MY_CUSTOM_KEY_\\d+' }],
    });
    expect(result).not.toContain('MY_CUSTOM_KEY_12345');
    expect(result).toContain('[REDACTED:custom-key]');
  });

  test('handles content with no sensitive data gracefully', () => {
    const input = 'Simple project note about API design.';
    expect(filterSensitiveData(input)).toBe(input);
  });

  test('handles empty content', () => {
    expect(filterSensitiveData('')).toBe('');
  });
});

describe('containsSensitiveData', () => {
  test('detects API keys', () => {
    expect(containsSensitiveData('sk-abc123def456')).toBe(true);
  });

  test('returns false for normal content', () => {
    expect(containsSensitiveData('Normal conversation about code')).toBe(false);
  });

  test('detects private keys', () => {
    expect(containsSensitiveData('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
  });
});
