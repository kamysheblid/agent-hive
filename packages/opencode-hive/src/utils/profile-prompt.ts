/**
 * Profile Prompt — build analysis prompts for user profile learning.
 *
 * Pattern sourced from tickernelz/opencode-mem.
 * Analyzes user messages to identify preferences, patterns, and workflows.
 * Uses the connected OpenCode provider — no extra API keys needed.
 */

export interface ProfileAnalysisResult {
  preferences: Array<{
    key: string;
    value: string;
    confidence: number; // 0-1
    category: 'code-style' | 'communication' | 'tool' | 'workflow' | 'preference';
  }>;
  detected_patterns: string[];
}

/**
 * Build the analysis prompt for profile learning.
 * @param messages - Recent user messages to analyze
 * @returns System prompt + user prompt for the LLM
 */
export function buildProfileAnalysisPrompt(messages: string[]): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You are a user profiling assistant. Analyze the user\'s messages to identify:',
    '',
    '1. **Preferences**: What the user consistently prefers (code style, tools, communication)',
    '2. **Patterns**: Recurring topics, problem domains, technical interests',
    '3. **Workflows**: Development habits, sequences, learning style',
    '',
    'Respond with a JSON object:',
    '{',
    '  "preferences": [',
    '    { "key": "code_style", "value": "prefers async/await", "confidence": 0.9, "category": "code-style" },',
    '    { "key": "tool_preference", "value": "prefers bun over npm", "confidence": 0.7, "category": "tool" }',
    '  ],',
    '  "detected_patterns": ["uses TypeScript", "prefers functional style"]',
    '}',
    '',
    'Rules:',
    '- Only include high-confidence observations (confidence >= 0.6)',
    '- Max 10 preferences per analysis',
    '- Categories: code-style, communication, tool, workflow, preference',
    '- Do NOT include personally identifiable information',
    '- Keep values concise (1-10 words)',
    '- If no clear patterns, return {"preferences": [], "detected_patterns": []}',
  ].join('\n');

  const formattedMessages = messages
    .map((m, i) => `[${i + 1}] ${m.slice(0, 500)}`)
    .join('\n\n');

  const userPrompt = [
    'Analyze these user messages for preferences and patterns:',
    '---',
    formattedMessages.slice(0, 6000),
    '---',
    'Return JSON with preferences array and detected_patterns array.',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

/**
 * Parse the LLM response into a ProfileAnalysisResult.
 */
export function parseProfileAnalysisResponse(response: string): ProfileAnalysisResult | null {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed.preferences)) {
      return {
        preferences: parsed.preferences.filter(
          (p: any) => p.key && p.value && typeof p.confidence === 'number' && p.category,
        ),
        detected_patterns: Array.isArray(parsed.detected_patterns) ? parsed.detected_patterns : [],
      };
    }
    return null;
  } catch {
    // Try extracting from markdown code block
    const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed.preferences)) {
          return {
            preferences: parsed.preferences.filter(
              (p: any) => p.key && p.value && typeof p.confidence === 'number' && p.category,
            ),
            detected_patterns: Array.isArray(parsed.detected_patterns) ? parsed.detected_patterns : [],
          };
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}
