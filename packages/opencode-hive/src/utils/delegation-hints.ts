/**
 * Delegation Hints Utility
 * 
 * Provides intelligent hints for task delegation:
 * - Complexity scoring
 * - Agent recommendation
 * - Parallel candidates
 * - Time estimation
 */

import type { TaskInfo } from 'hive-core';

export type Complexity = 'simple' | 'medium' | 'complex';

export interface DelegationHints {
  estimatedComplexity: Complexity;
  recommendedAgent: string;
  parallelCandidates: string[];
  estimatedTime: string;
  warnings: string[];
}

/**
 * Complexity keywords for scoring
 */
const COMPLEXITY_KEYWORDS = {
  simple: [
    'fix typo', 'add comment', 'update readme', 'rename', 'delete comment',
    'simple', 'minor', 'cosmetic', 'format', 'lint fix',
  ],
  medium: [
    'add feature', 'implement', 'create component', 'modify', 'update',
    'refactor', 'optimize', 'add test', 'enhance', 'improve',
  ],
  complex: [
    'architect', 'design system', 'redesign', 'migrate', 'refactor major',
    'multi-module', 'distributed', 'complex', 'algorithm', 'security',
    'performance critical', 'database schema', 'api redesign',
  ],
};

/**
 * Agent recommendations by task type
 */
const AGENT_RECOMMENDATIONS: Record<string, { agent: string; reason: string }> = {
  'simple': { agent: 'forager-worker', reason: 'Simple task, fast execution' },
  'medium': { agent: 'forager-worker', reason: 'Standard implementation task' },
  'complex': { agent: 'architect', reason: 'Complex task needs planning review' },
  'test': { agent: 'forager-worker', reason: 'Testing task' },
  'docs': { agent: 'forager-worker', reason: 'Documentation task' },
  'fix': { agent: 'forager-worker', reason: 'Bug fix task' },
  'security': { agent: 'hygienic-reviewer', reason: 'Security-sensitive, needs review' },
};

/**
 * Time estimates by complexity
 */
const TIME_ESTIMATES: Record<Complexity, string> = {
  simple: '5-15 min',
  medium: '30-60 min',
  complex: '1-3 hours',
};

/**
 * Calculate task complexity based on task name and description
 */
export function calculateComplexity(taskName: string, taskDescription?: string): Complexity {
  const text = `${taskName} ${taskDescription || ''}`.toLowerCase();
  
  // Check for complex keywords
  for (const keyword of COMPLEXITY_KEYWORDS.complex) {
    if (text.includes(keyword)) {
      return 'complex';
    }
  }
  
  // Check for medium keywords
  for (const keyword of COMPLEXITY_KEYWORDS.medium) {
    if (text.includes(keyword)) {
      return 'medium';
    }
  }
  
  // Check for simple keywords
  for (const keyword of COMPLEXITY_KEYWORDS.simple) {
    if (text.includes(keyword)) {
      return 'simple';
    }
  }
  
  // Default to medium
  return 'medium';
}

/**
 * Select the best agent for a task
 */
export function selectAgent(taskName: string, taskDescription?: string): {
  agent: string;
  reason: string;
} {
  const text = `${taskName} ${taskDescription || ''}`.toLowerCase();
  
  // Check specific keywords
  for (const [keyword, recommendation] of Object.entries(AGENT_RECOMMENDATIONS)) {
    if (text.includes(keyword)) {
      return recommendation;
    }
  }
  
  // Default based on complexity
  const complexity = calculateComplexity(taskName, taskDescription);
  return AGENT_RECOMMENDATIONS[complexity];
}

/**
 * Find tasks that can be executed in parallel
 */
export function findParallelCandidates(
  currentTask: string,
  allTasks: TaskInfo[],
  dependencies: Map<string, string[]>
): string[] {
  const candidates: string[] = [];
  
  for (const task of allTasks) {
    // Skip current task
    if (task.folder === currentTask) continue;
    
    // Skip completed tasks
    if (task.status === 'done') continue;
    
    // Skip blocked tasks
    if (task.status === 'blocked') continue;
    
    // Check if task has dependencies on current task
    const taskDeps = dependencies.get(task.folder) || [];
    const hasCurrentAsDependency = taskDeps.includes(currentTask);
    
    // Check if current task depends on this task
    const currentDeps = dependencies.get(currentTask) || [];
    const hasThisAsDependency = currentDeps.includes(task.folder);
    
    // Can run in parallel if:
    // 1. Current task doesn't depend on this task
    // 2. This task doesn't depend on current task
    if (!hasCurrentAsDependency && !hasThisAsDependency) {
      candidates.push(task.folder);
    }
  }
  
  return candidates.slice(0, 5);  // Limit to 5 candidates
}

/**
 * Estimate time for a task
 */
export function estimateTime(taskName: string, taskDescription?: string): string {
  const complexity = calculateComplexity(taskName, taskDescription);
  return TIME_ESTIMATES[complexity];
}

/**
 * Generate warnings for a task
 */
export function generateWarnings(
  taskName: string,
  taskDescription?: string,
  allTasks?: TaskInfo[]
): string[] {
  const warnings: string[] = [];
  const text = `${taskName} ${taskDescription || ''}`.toLowerCase();
  
  // Check for potential issues
  if (text.includes('database') || text.includes('migration')) {
    warnings.push('⚠️ Database changes - ensure backup before running');
  }
  
  if (text.includes('security') || text.includes('auth') || text.includes('permission')) {
    warnings.push('🔒 Security-sensitive task - consider review before merge');
  }
  
  if (text.includes('api') && text.includes('breaking')) {
    warnings.push('⚠️ Breaking API change - coordinate with dependent services');
  }
  
  if (text.includes('test') && !text.includes('add')) {
    warnings.push('📝 Test modification - ensure existing tests still pass');
  }
  
  return warnings;
}

/**
 * Get complete delegation hints for a task
 */
export function getDelegationHints(
  taskName: string,
  taskDescription: string | undefined,
  allTasks: TaskInfo[],
  dependencies: Map<string, string[]>
): DelegationHints {
  const complexity = calculateComplexity(taskName, taskDescription);
  const agentSelection = selectAgent(taskName, taskDescription);
  const parallelCandidates = findParallelCandidates(taskName, allTasks, dependencies);
  const estimatedTime = estimateTime(taskName, taskDescription);
  const warnings = generateWarnings(taskName, taskDescription, allTasks);
  
  return {
    estimatedComplexity: complexity,
    recommendedAgent: agentSelection.agent,
    parallelCandidates,
    estimatedTime,
    warnings,
  };
}
