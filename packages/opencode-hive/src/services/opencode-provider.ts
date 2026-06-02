/**
 * OpenCode Provider Service — piggyback on session.prompt for structured output.
 *
 * Pattern sourced from tickernelz/opencode-mem.
 * Instead of requiring separate API keys for auto-capture, uses the connected
 * OpenCode provider (the same one the user uses for chat). OpenCode owns auth,
 * token refresh, and provider routing — no extra API configuration needed.
 *
 * Key design:
 * - Uses `client.session.prompt()` for LLM calls (no separate API keys)
 * - Simplified schema validation (not Zod — keeps bundle size small)
 * - 0-risk: every method catches errors and returns null
 * - Graceful degradation when client is unavailable
 */

export interface GenerateStructedParams {
  systemPrompt: string;
  userPrompt: string;
  /** Expected fields in the response (simplified schema: just field names for validation) */
  expectedFields?: string[];
}

/**
 * Service that uses the connected OpenCode provider for LLM calls.
 * No extra API keys needed — piggybacks on the user's existing provider.
 */
export class OpenCodeProviderService {
  constructor(private client: any) {}

  /**
   * Ask the LLM to extract structured information via session.prompt.
   * Uses the connected OpenCode provider — no separate API configuration.
   *
   * @returns Parsed JSON object, or null on any failure (0-risk)
   */
  async generateStructured<T extends Record<string, unknown> = Record<string, unknown>>(
    params: GenerateStructedParams,
  ): Promise<T | null> {
    // 0-risk guard
    if (!this.client?.session?.prompt) return null;

    try {
      const response = await this.client.session.prompt({
        body: {
          parts: [
            { type: 'text' as const, text: params.systemPrompt, synthetic: true as const },
            { type: 'text' as const, text: params.userPrompt },
          ],
          noReply: true as const,
        },
      });

      if (!response?.body?.parts?.[0]?.text) return null;

      const text = response.body.parts[0].text;

      // Try to parse JSON from response
      const parsed = this.parseJSON(text);
      if (!parsed) return null;

      // Validate expected fields if specified
      if (params.expectedFields && params.expectedFields.length > 0) {
        const hasAllFields = params.expectedFields.every(field => field in parsed);
        if (!hasAllFields) return null;
      }

      return parsed as T;
    } catch (error) {
      // 0-risk: never throw
      console.warn(
        '[opencode-provider] generateStructured failed:',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Check if the provider is available.
   * Makes a lightweight LLM call to verify connectivity.
   * 0-risk: returns false on any failure.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.generateStructured<{ status: string }>({
        systemPrompt: 'You are a health check service.',
        userPrompt: 'Respond with a JSON object: {"status": "ok"}',
        expectedFields: ['status'],
      });
      return result?.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Capture and structure session content using the OpenCode provider.
   * Returns structured memory content suitable for vector memory storage.
   *
   * @param sessionContext - Raw session text to structure
   * @returns Structured memory content, or null on failure
   */
  async captureStructuredMemory(sessionContext: string): Promise<string | null> {
    const systemPrompt = [
      'You are a memory curator. Extract key information from the following session context.',
      'Respond with a JSON object containing:',
      '- "summary": A 1-2 sentence summary of the session',
      '- "key_decisions": Array of decisions made (strings)',
      '- "key_learnings": Array of insights learned (strings)',
      '- "active_tasks": Array of task names mentioned (strings)',
      '- "tags": Array of relevant topic tags (strings)',
    ].join('\n');

    const result = await this.generateStructured<{
      summary?: string;
      key_decisions?: string[];
      key_learnings?: string[];
      active_tasks?: string[];
      tags?: string[];
    }>({
      systemPrompt,
      userPrompt: `Session context:\n\n${sessionContext.slice(0, 4000)}`,
      expectedFields: ['summary'],
    });

    if (!result?.summary) return null;

    // Format as structured text for vector memory storage
    const parts: string[] = [result.summary];
    if (result.key_decisions?.length) {
      parts.push('', 'Decisions:', ...result.key_decisions.map(d => `  - ${d}`));
    }
    if (result.key_learnings?.length) {
      parts.push('', 'Learnings:', ...result.key_learnings.map(l => `  - ${l}`));
    }
    if (result.active_tasks?.length) {
      parts.push('', 'Tasks:', ...result.active_tasks.map(t => `  - ${t}`));
    }
    if (result.tags?.length) {
      parts.push('', `Tags: ${result.tags.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Extract JSON from response text, handling markdown code blocks.
   */
  private parseJSON(text: string): Record<string, unknown> | null {
    // Try direct JSON parse first
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON — try extracting from markdown
    }

    // Try extracting from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\n?\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }

    // Try finding any JSON object in the text
    const looseMatch = text.match(/\{[\s\S]*?"\w+"[\s\S]*?\}/);
    if (looseMatch) {
      try {
        const parsed = JSON.parse(looseMatch[0]);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }

    return null;
  }
}
