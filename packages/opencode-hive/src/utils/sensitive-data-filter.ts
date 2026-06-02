/**
 * Sensitive Data Filter
 *
 * Automatically detects and redacts sensitive information before
 * saving to memory. Applied globally to all memory write paths
 * (vector memory, memory blocks, auto-capture).
 *
 * Configurable via agent_hive.json → memoryFilter.
 *
 * Patterns supported:
 * - API keys (sk-*, pk-*, github personal tokens, etc.)
 * - AWS access keys + secret keys
 * - Private keys (RSA, ECDSA, ED25519, etc.)
 * - JWT tokens
 * - Generic bearer tokens
 * - Connection strings (postgres://, mysql://, mongodb://, etc.)
 * - Email addresses (optional, configurable)
 * - URLs containing credentials
 * - Environment variable assignments with sensitive values
 */

// ---------------------------------------------------------------------------
// Default patterns
// Each pattern has: regex (to match), and a replacer function
// ---------------------------------------------------------------------------

interface SensitivePattern {
  name: string;
  regex: RegExp;
  replacement: string;
  /** If true, the entire line/value is redacted. If false, only the secret portion. */
  redactFullValue?: boolean;
}

const DEFAULT_PATTERNS: SensitivePattern[] = [
  // Private keys (multi-line) — first so broad env-var patterns don't eat the header
  {
    name: 'Private key block',
    regex: /-----BEGIN\s+(?:RSA|DSA|EC|ED25519|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|DSA|EC|ED25519|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/g,
    replacement: '[PRIVATE_KEY_REDACTED]',
  },

  // Single-line private key headers (detects header even without full block)
  {
    name: 'Private key header',
    regex: /-----BEGIN\s+(?:RSA|DSA|EC|ED25519|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/g,
    replacement: '[PRIVATE_KEY_REDACTED]',
  },

  // JWT tokens (base64url.base64url.signature)
  {
    name: 'JWT token',
    regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    replacement: '[JWT_REDACTED]',
  },

  // GitHub personal access tokens: ghp_... gho_... gh_... github_pat_...
  {
    name: 'GitHub token',
    regex: /(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[a-zA-Z0-9_-]{20,}/g,
    replacement: '[GITHUB_TOKEN_REDACTED]',
  },

  // OpenAI / Anthropic / generic API keys: sk-... pk-... sv-...
  {
    name: 'API key (sk-/pk-/sv- prefix)',
    regex: /(?:sk-|pk-|sv-|api-)[a-zA-Z0-9_-]{12,}/g,
    replacement: '[API_KEY_REDACTED]',
  },

  // AWS access key: AKIA... (20 uppercase chars)
  {
    name: 'AWS access key',
    regex: /(?:AKIA|ASIA)[A-Z0-9]{16,}/g,
    replacement: '[AWS_KEY_REDACTED]',
  },

  // AWS secret key
  {
    name: 'AWS secret key',
    regex: /(aws_secret_access_key|aws_secret_key)\s*[:=]\s*['"]?\S+['"]?/gi,
    replacement: '$1: [REDACTED]',
  },

  // Generic bearer tokens in headers
  {
    name: 'Bearer token',
    regex: /(Bearer\s+)[a-zA-Z0-9._-]{20,}/gi,
    replacement: '$1[TOKEN_REDACTED]',
  },

  // Connection strings with credentials — capture groups to replace just the credentials part
  {
    name: 'Database connection string',
    regex: /((?:postgres|mysql|mongodb|redis|amqp|mqtt):\/\/)([^@\s]+:[^@\s]+)@/g,
    replacement: '$1[CREDENTIALS_REDACTED]@',
  },

  // Environment variable assignments: KEY=value where value looks sensitive
  // Uses negative lookahead to avoid stomping on already-redacted values
  {
    name: 'Sensitive env var',
    regex: /((?:API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIALS|PRIVATE_KEY)\s*=\s*['"]?)(?!\[)\S+/gi,
    replacement: '$1[REDACTED]',
  },

  // Passwords in config strings: password=... pwd=... passwd=...
  {
    name: 'Password in config',
    regex: /(password|pwd|passwd)\s*[:=]\s*['"]?(?!\[)\S+['"]?/gi,
    replacement: '$1: [REDACTED]',
  },
];

// ---------------------------------------------------------------------------
// Config interface
// ---------------------------------------------------------------------------

export interface MemoryFilterConfig {
  enabled?: boolean;
  /** Custom additional regex patterns (each with name and pattern string) */
  customPatterns?: Array<{ name: string; pattern: string }>;
  /** Whether to redact email addresses (default: false) */
  redactEmails?: boolean;
}

// ---------------------------------------------------------------------------
// Filter function
// ---------------------------------------------------------------------------

/**
 * Redact sensitive data from content before saving to memory.
 *
 * @param content - Raw content to sanitize
 * @param config - Optional config object
 * @returns Sanitized content with sensitive data replaced
 */
export function filterSensitiveData(
  content: string,
  config?: MemoryFilterConfig,
): string {
  if (config?.enabled === false) {
    return content; // Skip filtering if disabled
  }

  let result = content;

  // Apply default patterns
  for (const pattern of DEFAULT_PATTERNS) {
    result = result.replace(pattern.regex, pattern.replacement);
  }

  // Apply custom patterns
  if (config?.customPatterns) {
    for (const custom of config.customPatterns) {
      try {
        const regex = new RegExp(custom.pattern, 'g');
        result = result.replace(regex, `[REDACTED:${custom.name}]`);
      } catch {
        // Skip invalid regex patterns
        console.warn(`[sensitive-filter] Invalid regex pattern: ${custom.name}`);
      }
    }
  }

  // Email addresses (optional, off by default)
  if (config?.redactEmails) {
    // Simple email pattern - avoid matching things in code (e.g., foo@bar.com in comments)
    result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
  }

  return result;
}

/**
 * Quick check if content likely contains sensitive data (for logging/audit).
 */
export function containsSensitiveData(content: string): boolean {
  for (const pattern of DEFAULT_PATTERNS) {
    // Reset lastIndex because global regexes maintain state
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(content)) {
      return true;
    }
  }
  return false;
}
