/**
 * Judge Prompt — heuristic detectors + system prompt for hidden-session judge.
 *
 * Pattern sourced from dzianisv/opencode-plugins (reflection-3.ts).
 * Heuristic detectors identify common premature-stop patterns
 * before involving the LLM. The full judge runs in a hidden session
 * to avoid biasing the main conversation.
 *
 * Judge rubric mined from 227 real agent stops (78% premature).
 * Keep this minimal — not the 2000-line reflection-3.ts.
 */

export interface TaskContext {
  toolCalls: number;
  writeRatio: number;
  lastMessage: string;
  consecutiveIdenticalCommands?: number;
}

export type HeuristicVerdict = 'premature' | 'suspicious' | 'normal' | null;

/**
 * PLANNING_LOOP detector: agent makes many tool calls but writes very little.
 * Pattern: high toolCalls + low writeRatio → agent is stuck planning/investigating
 * without making progress.
 */
export function detectPlanningLoop(ctx: TaskContext, writeRatioThreshold: number = 0.1): HeuristicVerdict {
  if (ctx.toolCalls < 5) return null;
  if (ctx.writeRatio < writeRatioThreshold) return 'premature';
  return null;
}

/**
 * ACTION_LOOP detector: agent runs the same command repeatedly.
 * Pattern: 3+ consecutive identical commands → agent is in a loop.
 */
export function detectActionLoop(ctx: TaskContext): HeuristicVerdict {
  if ((ctx.consecutiveIdenticalCommands ?? 0) >= 3) return 'premature';
  return null;
}

/**
 * PERMISSION-SEEKING detector: final turn asks yes/no about something the
 * agent can do itself → premature stop.
 * Pattern: message contains permission-asking phrases.
 */
export function detectPermissionSeeking(lastMessage: string): HeuristicVerdict {
  const permissionPatterns = [
    /should\s+i\s+/i,
    /can\s+i\s+/i,
    /do\s+you\s+want\s+me\s+to/i,
    /would\s+you\s+like\s+me\s+to/i,
    /shall\s+i\s+/i,
    /may\s+i\s+/i,
  ];

  const matches = permissionPatterns.filter(p => p.test(lastMessage));
  if (matches.length >= 2) return 'premature';
  if (matches.length === 1) return 'suspicious';
  return null;
}

/**
 * STOPPED-WITH-TODOS detector: response lists remaining tasks and stops.
 * Pattern: mentions "remaining tasks", "next steps", "todo" while work remains.
 */
export function detectStoppedWithTodos(lastMessage: string): HeuristicVerdict {
  const todoPatterns = [
    /remaining\s+(tasks?|steps?|work)/i,
    /next\s+steps?/i,
    /to\s+do/i,
    /unfinished/i,
    /the\s+following\s+(tasks?|steps?)/i,
    /what\s+(else|next)/i,
  ];

  const matches = todoPatterns.filter(p => p.test(lastMessage));
  // Only flag if there's also a stopping signal
  const hasStopSignal = /let\s+me\s+know|if\s+you\s+(need|want|have)|i['']?ll\s+(wait|stop|pause)/i.test(lastMessage);
  
  if (matches.length >= 1 && hasStopSignal) return 'premature';
  if (matches.length >= 2) return 'suspicious';
  return null;
}

/**
 * FALSE-COMPLETE detector: claims done but no verification evidence.
 * Pattern: says "done", "complete", "finished" but no test/verification commands.
 */
export function detectFalseComplete(lastMessage: string): HeuristicVerdict {
  const completePatterns = [
    /task\s+(complete|done|finished)/i,
    /works?\s+(correctly|as\s+expected|now)/i,
    /all\s+(done|set|good)/i,
    /completed\s+(successfully|without\s+errors?)/i,
  ];

  const hasClaim = completePatterns.some(p => p.test(lastMessage));
  if (!hasClaim) return null;

  // Check for verification evidence in the message
  const hasVerificationEvidence = /tests?\s+(pass|succeed|green)|verified|confirmed|validated/i.test(lastMessage);
  const hasVerificationCommand = /bun\s+run\s+test|npm\s+(run\s+)?test|pytest|go\s+test|cargo\s+test/i.test(lastMessage);

  if (hasClaim && !hasVerificationEvidence && !hasVerificationCommand) {
    return 'premature';
  }

  return null;
}

/**
 * Run all heuristic detectors and return the most severe verdict.
 */
export function runHeuristicDetectors(ctx: TaskContext): { verdict: HeuristicVerdict; reason: string | null } {
  // Check planning loop (most common premature stop)
  const planningLoop = detectPlanningLoop(ctx);
  if (planningLoop === 'premature') {
    return { verdict: 'premature', reason: 'PLANNING_LOOP: Many tool calls with low write ratio — agent investigating without making progress' };
  }

  // Check action loop
  const actionLoop = detectActionLoop(ctx);
  if (actionLoop === 'premature') {
    return { verdict: 'premature', reason: 'ACTION_LOOP: Repeated identical commands detected' };
  }

  // Check permission seeking
  const permissionSeeking = detectPermissionSeeking(ctx.lastMessage);
  if (permissionSeeking === 'premature') {
    return { verdict: 'premature', reason: 'PERMISSION-SEEKING: Final turn asks permission instead of acting' };
  }

  // Check stopped with todos
  const stoppedWithTodos = detectStoppedWithTodos(ctx.lastMessage);
  if (stoppedWithTodos === 'premature') {
    return { verdict: 'premature', reason: 'STOPPED-WITH-TODOS: Response lists remaining tasks but stops' };
  }

  // Check false complete
  const falseComplete = detectFalseComplete(ctx.lastMessage);
  if (falseComplete === 'premature') {
    return { verdict: 'premature', reason: 'FALSE-COMPLETE: Claims completion without verification evidence' };
  }

  // Return first suspicious result
  if (planningLoop === 'suspicious') return { verdict: 'suspicious', reason: 'Borderline planning loop' };
  if (permissionSeeking === 'suspicious') return { verdict: 'suspicious', reason: 'Possible permission-seeking' };
  if (stoppedWithTodos === 'suspicious') return { verdict: 'suspicious', reason: 'Possible incomplete work' };

  return { verdict: 'normal', reason: null };
}

/**
 * Build the system prompt for the hidden-session judge LLM call.
 * Short and focused — not the 2000-line reflection-3.ts.
 */
export function buildJudgeSystemPrompt(): string {
  return `You are a task completion judge. Your job is to determine if an AI coding assistant has truly completed its task or stopped prematurely.

Review the conversation and assess:

1. **TRUE-COMPLETE**: The assistant provided verification evidence (test results, build output, explicit confirmation). Task requirements are demonstrably met. No remaining work is implied.

2. **FALSE-COMPLETE**: The assistant claims the task is done but provides no verification evidence. No tests were run, no commands were executed to confirm.

3. **PERMISSION-SEEKING**: The assistant's last turn asks for permission to do something it could do itself (e.g., "Should I run the tests?"). This is a premature stop.

4. **STOPPED-WITH-TODOS**: The assistant lists remaining tasks or next steps but stops anyway instead of continuing.

5. **PLANNING_LOOP**: The assistant made many tool calls but produced little actual output. It's stuck investigating.

Respond with ONLY a JSON object:
{"verdict": "complete" | "incomplete", "reason": "Brief explanation (1-2 sentences)"}`;
}

/**
 * Parse judge LLM response into structured verdict.
 */
export function parseJudgeResponse(response: string): { verdict: 'complete' | 'incomplete'; reason: string } | null {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(response);
    if (parsed.verdict && (parsed.verdict === 'complete' || parsed.verdict === 'incomplete')) {
      return {
        verdict: parsed.verdict,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
      };
    }
    return null;
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.verdict && (parsed.verdict === 'complete' || parsed.verdict === 'incomplete')) {
          return {
            verdict: parsed.verdict,
            reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
          };
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}
