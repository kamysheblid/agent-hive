/**
 * Hidden-Session Judge — task completion verification.
 *
 * Pattern sourced from dzianisv/opencode-plugins (reflection-3.ts).
 * Uses heuristic detectors first (no LLM cost), then optional LLM judge
 * in a hidden session. 0-risk: all operations wrapped in try-catch.
 *
 * Key design decisions:
 * - Opt-in only (hiddenJudge.enabled = false by default — judge consumes LLM tokens)
 * - Heuristic-only fallback when client.session.create() is unavailable
 * - Max 3 retries per task (Reflexion-style, Shinn et al. 2023)
 * - Ephemeral: no persistent storage of judge evaluations
 * - Anti-recursion: judge never evaluates judge sessions
 */

import type { TaskContext, HeuristicVerdict } from '../utils/judge-prompt.js';
import { runHeuristicDetectors, buildJudgeSystemPrompt, parseJudgeResponse } from '../utils/judge-prompt.js';

export interface HiddenJudgeConfig {
  enabled?: boolean;
  maxRetries?: number;
  minToolCalls?: number;
  writeRatioThreshold?: number;
}

export interface JudgeEvaluation {
  verdict: 'complete' | 'incomplete';
  source: 'heuristic' | 'llm';
  reason: string;
}

export interface EvaluateParams {
  sessionId: string;
  client: any;
  taskContext: TaskContext;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MIN_TOOL_CALLS = 5;
const DEFAULT_WRITE_RATIO_THRESHOLD = 0.1;

/**
 * Hidden judge service that evaluates task completion.
 * Uses heuristic detectors first, then optional LLM judge via hidden session.
 */
export class HiddenJudgeService {
  private config: HiddenJudgeConfig;
  /** Track retry counts per task to prevent infinite judge loops */
  private retryCounts = new Map<string, number>();

  constructor(config: HiddenJudgeConfig) {
    this.config = config;
  }

  /**
   * Main entry point — evaluate task completion and inject feedback if needed.
   * 0-risk: never throws, always returns gracefully.
   */
  async evaluateAndFeedback(params: EvaluateParams): Promise<void> {
    // 0-risk guard
    if (!this.isEnabled()) return;
    if (!params.client) return;

    try {
      // Guard: min tool calls threshold
      if (params.taskContext.toolCalls < (this.config.minToolCalls ?? DEFAULT_MIN_TOOL_CALLS)) {
        return;
      }

      // Guard: check retry count to prevent infinite loops
      const retryCount = this.retryCounts.get(params.sessionId) ?? 0;
      const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
      if (retryCount >= maxRetries) {
        console.log('[hidden-judge] Max retries reached for session:', params.sessionId);
        return;
      }

      // Step 1: Run heuristic detectors (no LLM cost)
      const heuristicResult = runHeuristicDetectors(params.taskContext);

      if (heuristicResult.verdict === 'normal') {
        // Heuristics say normal — optionally run LLM judge for deeper check
        const llmVerdict = await this.runLLMJudge(params);
        if (!llmVerdict || llmVerdict.verdict === 'complete') {
          return; // LLM also says complete — no action needed
        }
        // LLM says incomplete — inject feedback
        await this.injectFeedback(params.sessionId, params.client, llmVerdict);
        return;
      }

      // Step 2: Heuristic triggered — inject feedback directly
      // No LLM call needed for clear heuristic violations
      if (heuristicResult.verdict === 'premature') {
        await this.injectFeedback(params.sessionId, params.client, {
          verdict: 'incomplete',
          source: 'heuristic',
          reason: heuristicResult.reason ?? 'Heuristic detected premature stop',
        });
        return;
      }

      // Suspicious — run LLM judge for confirmation
      if (heuristicResult.verdict === 'suspicious') {
        const llmVerdict = await this.runLLMJudge(params);
        if (llmVerdict && llmVerdict.verdict === 'incomplete') {
          await this.injectFeedback(params.sessionId, params.client, llmVerdict);
        }
        return;
      }
    } catch (error) {
      // 0-risk: never throw
      console.warn(
        '[hidden-judge] Evaluation failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Run LLM judge in a hidden session.
   * Falls back gracefully if hidden session creation is unavailable.
   */
  private async runLLMJudge(params: EvaluateParams): Promise<JudgeEvaluation | null> {
    // 0-risk guard
    if (!params.client?.session?.create || !params.client?.session?.prompt) {
      return null; // Hidden sessions not available — skip LLM judge
    }

    try {
      // Create hidden session for unbiased evaluation
      const judgeSessionId = `judge-${params.sessionId}-${Date.now()}`;
      
      // Some clients may not support session.create — guard accordingly
      let _hiddenSession: any;
      try {
        _hiddenSession = await params.client.session.create({ id: judgeSessionId });
      } catch {
        return null; // Hidden session creation failed — skip LLM judge
      }

      // Build the evaluation prompt with task context
      const userPrompt = [
        'Review the following task execution context and determine if the task was completed:',
        '',
        `- Total tool calls made: ${params.taskContext.toolCalls}`,
        `- Write ratio (writes/total): ${params.taskContext.writeRatio.toFixed(2)}`,
        `- Consecutive identical commands: ${params.taskContext.consecutiveIdenticalCommands ?? 0}`,
        '',
        'Last message from the agent:',
        '---',
        params.taskContext.lastMessage.slice(0, 2000),
        '---',
        '',
        'Respond with a JSON verdict: {"verdict": "complete" | "incomplete", "reason": "..."}',
      ].join('\n');

      const systemPrompt = buildJudgeSystemPrompt();

      // Run judge in hidden session
      const response = await params.client.session.prompt({
        path: { id: judgeSessionId },
        body: {
          parts: [
            { type: 'text' as const, text: systemPrompt, synthetic: true as const },
            { type: 'text' as const, text: userPrompt },
          ],
          noReply: true as const,
        },
      });

      if (!response?.body?.parts?.[0]?.text) {
        return null;
      }

      const parsed = parseJudgeResponse(response.body.parts[0].text);
      if (!parsed) return null;

      return {
        verdict: parsed.verdict,
        source: 'llm',
        reason: parsed.reason,
      };
    } catch (error) {
      console.warn(
        '[hidden-judge] LLM judge failed:',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Inject judge feedback into the main session.
   * Uses session.prompt with synthetic parts to avoid polluting context.
   */
  private async injectFeedback(
    sessionId: string,
    client: any,
    evaluation: JudgeEvaluation,
  ): Promise<void> {
    // 0-risk guard
    if (!client?.session?.prompt) return;

    try {
      // Increment retry count
      const current = this.retryCounts.get(sessionId) ?? 0;
      this.retryCounts.set(sessionId, current + 1);

      const feedbackMessage = [
        '<judge_feedback>',
        `The task completion judge detected a potential issue (${evaluation.source} evaluation):`,
        '',
        `Verdict: ${evaluation.verdict}`,
        `Reason: ${evaluation.reason}`,
        '',
        'Please review your progress and ensure the task is truly complete.',
        'Run verification commands (tests, build) if you claim completion.',
        'If you are genuinely stuck, describe what is blocking you.',
        '</judge_feedback>',
      ].join('\n');

      await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [
            {
              type: 'text' as const,
              text: feedbackMessage,
              synthetic: true as const,
            },
          ],
          noReply: true as const,
        },
      });
    } catch (error) {
      console.warn(
        '[hidden-judge] Failed to inject feedback:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Clean up retry tracking for a session.
   */
  clearRetryCount(sessionId: string): void {
    this.retryCounts.delete(sessionId);
  }

  private isEnabled(): boolean {
    return this.config?.enabled === true;
  }
}
