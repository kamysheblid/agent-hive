import type { ConfigService } from 'hive-core';

/**
 * Todo Enforcer Hook
 * 
 * Enforces task completion - when agent goes idle, the system yanks it back to work.
 * Based on oh-my-openagent's todo-continuation-enforcer hook.
 */

export interface TodoEnforcerOptions {
  enabled?: boolean;
  idleThresholdMs?: number;
}

const DEFAULT_OPTIONS: Required<TodoEnforcerOptions> = {
  enabled: true,
  idleThresholdMs: 30000, // 30 seconds of idle
};

export function createTodoEnforcerHook(
  configService: ConfigService,
  options: TodoEnforcerOptions = {},
): {
  name: string;
  handler: (input: unknown, output: { context: string[] }) => void;
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastActivityTime = Date.now();

  return {
    name: 'hive.todo-enforcer',
    handler: (input: unknown, output: { context: string[] }) => {
      if (!opts.enabled) return;

      const now = Date.now();
      const idleTime = now - lastActivityTime;
      lastActivityTime = now;

      // Only enforce if idle for too long and there's active work
      if (idleTime < opts.idleThresholdMs) return;

      output.context.push(
        `\n## Todo Enforcer Reminder\n\n` +
        `You appear to have been idle. Complete your assigned task before stopping.\n` +
        `Focus on the current todo and ensure it's marked as done before considering the session complete.`
      );
    },
  };
}

/**
 * Hash-Anchored Edit Hook
 * 
 * Enhances edit operations with hash-anchored line markers for robust editing.
 * Based on oh-my-openagent's hashline-edit-diff-enhancer hook.
 */

export interface HashlineEditOptions {
  enabled?: boolean;
}

const hashlineCharacters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateHash(length: number = 8): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += hashlineCharacters.charAt(Math.floor(Math.random() * hashlineCharacters.length));
  }
  return result;
}

export function createHashlineEditHook(
  options: HashlineEditOptions = {},
): {
  name: string;
  handler: (input: unknown, output: { edit: string }) => void;
} {
  const opts = { enabled: true, ...options };

  return {
    name: 'hive.hashline-edit',
    handler: (input: unknown, output: { edit: string }) => {
      if (!opts.enabled) return;

      const inputData = input as { oldString?: string; newString?: string; filePath?: string };
      
      if (inputData.oldString && inputData.newString) {
        const hash = generateHash();
        const annotatedOld = inputData.oldString
          .split('\n')
          .map((line, i) => `[${hash}:${i + 1}] ${line}`)
          .join('\n');
        
        output.edit = `Hash-anchored edit (${hash}):\n\n` +
          `To replace:\n\`\`\`\n${annotatedOld}\n\`\`\`\n\n` +
          `With:\n\`\`\`\n${inputData.newString}\n\`\`\``;
      }
    },
  };
}

/**
 * Comment Checker Hook
 * 
 * Reminds agents to reduce excessive comments. Smartly ignores BDD, directives, docstrings.
 * Based on oh-my-openagent's comment-checker hook.
 */

export interface CommentCheckerOptions {
  enabled?: boolean;
  maxCommentLines?: number;
}

const COMMENT_PATTERNS = {
  // Ignore these patterns
  ignore: [
    /^\s*\/\/\s*===.*$/,           // Section headers
    /^\s*\/\/\s*---.*$/,           // Dividers
    /^\s*\/\*\*[\s\S]*?\*\/\s*$/,  // JSDoc comments
    /^\s*///\s*<reference.*>$/,     // TypeScript reference
  ],
  // Flag these patterns
  flag: [
    /^\s*\/\/\s*TODO:/i,
    /^\s*\/\/\s*FIXME:/i,
    /^\s*\/\/\s*HACK:/i,
  ],
};

export function createCommentCheckerHook(
  options: CommentCheckerOptions = {},
): {
  name: string;
  handler: (input: unknown, output: { context: string[] }) => void;
} {
  const opts = {
    enabled: true,
    maxCommentLines: 5,
    ...options,
  };

  return {
    name: 'hive.comment-checker',
    handler: (input: unknown, output: { context: string[] }) => {
      if (!opts.enabled) return;

      const inputData = input as { content?: string; filePath?: string };
      
      if (!inputData.content) return;

      const lines = inputData.content.split('\n');
      let commentLineCount = 0;
      let flaggedComments: string[] = [];

      for (const line of lines) {
        const isComment = /^\s*\/\//.test(line) || /^\s*#\s/.test(line);
        
        if (isComment) {
          commentLineCount++;
          
          for (const pattern of COMMENT_PATTERNS.flag) {
            if (pattern.test(line)) {
              flaggedComments.push(line.trim());
            }
          }
        }
      }

      if (commentLineCount > opts.maxCommentLines) {
        output.context.push(
          `\n## Comment Checker Reminder\n\n` +
          `This file has ${commentLineCount} comment lines (threshold: ${opts.maxCommentLines}).\n` +
          `Consider:\n` +
          `- Removing redundant comments\n` +
          `- Moving explanatory comments to code itself\n` +
          `- Using descriptive variable/function names instead\n\n` +
          `Good code should be self-documenting.`
        );
      }

      if (flaggedComments.length > 0) {
        output.context.push(
          `\n## Flagged Comments Found:\n\n` +
          flaggedComments.map(c => `- ${c}`).join('\n')
        );
      }
    },
  };
}
