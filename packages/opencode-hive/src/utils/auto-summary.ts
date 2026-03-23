/**
 * Auto-Summary Utility
 * 
 * Automatically summarizes task completion and suggests next actions.
 * Uses pattern learning to predict next steps.
 */

import { getPatternLearner, type PatternLearned } from './pattern-learner';

export interface TaskSummary {
  summary: string;
  keyChanges: string[];
  suggestions: string[];
  patterns: PatternLearned[];
}

export interface DiffAnalysis {
  addedFeatures: string[];
  bugFixes: string[];
  refactors: string[];
  testsAdded: number;
  filesChanged: number;
}

/**
 * Extract meaningful changes from git diff
 */
export function extractKeyChanges(diff: string): DiffAnalysis {
  const analysis: DiffAnalysis = {
    addedFeatures: [],
    bugFixes: [],
    refactors: [],
    testsAdded: 0,
    filesChanged: 0,
  };
  
  if (!diff) return analysis;
  
  // Count files changed
  const fileMatches = diff.match(/^diff --git/gm);
  analysis.filesChanged = fileMatches?.length || 0;
  
  // Find added features (new files, + additions)
  const featurePatterns = [
    /(?:feat|feature|add|new):\s*(.+)/gi,
    /\+{3}\s+(?:a|b)\/(.+)/g,  // New file paths
  ];
  
  for (const pattern of featurePatterns) {
    const matches = diff.match(pattern);
    if (matches) {
      analysis.addedFeatures.push(...matches.slice(0, 5));
    }
  }
  
  // Find bug fixes
  const fixPatterns = [
    /(?:fix|fixes|fixes bug|hotfix):\s*(.+)/gi,
    /(?:bug|issue):\s*(.+)/gi,
  ];
  
  for (const pattern of fixPatterns) {
    const matches = diff.match(pattern);
    if (matches) {
      analysis.bugFixes.push(...matches.slice(0, 5));
    }
  }
  
  // Find refactors
  const refactorPatterns = [
    /(?:refactor|restructure|reorganize):\s*(.+)/gi,
  ];
  
  for (const pattern of refactorPatterns) {
    const matches = diff.match(pattern);
    if (matches) {
      analysis.refactors.push(...matches.slice(0, 5));
    }
  }
  
  // Count test additions
  const testMatches = diff.match(/^\+.*(?:test|spec|spec\.ts|test\.ts)/gm);
  analysis.testsAdded = testMatches?.length || 0;
  
  return analysis;
}

/**
 * Generate a concise summary from diff analysis
 */
export function generateSummary(analysis: DiffAnalysis): string {
  const parts: string[] = [];
  
  if (analysis.addedFeatures.length > 0) {
    parts.push(`Added: ${analysis.addedFeatures.slice(0, 3).join(', ')}`);
  }
  
  if (analysis.bugFixes.length > 0) {
    parts.push(`Fixed: ${analysis.bugFixes.slice(0, 3).join(', ')}`);
  }
  
  if (analysis.refactors.length > 0) {
    parts.push(`Refactored: ${analysis.refactors.slice(0, 2).join(', ')}`);
  }
  
  if (analysis.testsAdded > 0) {
    parts.push(`${analysis.testsAdded} test(s) added`);
  }
  
  if (parts.length === 0) {
    parts.push(`${analysis.filesChanged} file(s) changed`);
  }
  
  return parts.join(' | ');
}

/**
 * Suggest next tasks based on patterns and completed tasks
 */
export function suggestNextTasks(completedTasks: string[], projectContext?: string): string[] {
  const suggestions: string[] = [];
  
  // Common patterns
  const commonPatterns: Record<string, string[]> = {
    'feature': ['Write tests', 'Update docs', 'Add error handling', 'Review for edge cases'],
    'bugfix': ['Add regression test', 'Check related areas', 'Update changelog'],
    'refactor': ['Run tests', 'Review for performance', 'Update dependent code'],
    'test': ['Run full test suite', 'Check coverage', 'Add edge case tests'],
    'docs': ['Verify examples work', 'Add more examples'],
  };
  
  // Detect task type from completed tasks
  const taskText = completedTasks.join(' ').toLowerCase();
  
  for (const [keyword, actions] of Object.entries(commonPatterns)) {
    if (taskText.includes(keyword)) {
      suggestions.push(...actions.slice(0, 2));
    }
  }
  
  // Use pattern learner if available
  try {
    const learner = getPatternLearner();
    const predictions = learner.predict(projectContext || taskText);
    
    for (const pred of predictions.slice(0, 3)) {
      if (!suggestions.includes(pred.action)) {
        suggestions.push(`Consider: ${pred.action}`);
      }
    }
  } catch {
    // Pattern learner not available
  }
  
  // Deduplicate and limit
  return [...new Set(suggestions)].slice(0, 5);
}

/**
 * Learn from task completion
 */
export function learnFromCompletion(
  taskName: string,
  taskContext: string,
  success: boolean,
  diff?: string
): void {
  try {
    const learner = getPatternLearner();
    
    // Extract patterns from task name
    const analysis = diff ? extractKeyChanges(diff) : { addedFeatures: [], bugFixes: [], refactors: [] };
    
    // Learn task completion pattern
    learner.learn('task_complete', taskName, success, taskContext);
    
    // Learn file change patterns
    if (analysis.addedFeatures.length > 0) {
      learner.learn('feature_added', analysis.addedFeatures[0], success, taskContext);
    }
    
    if (analysis.bugFixes.length > 0) {
      learner.learn('bug_fixed', analysis.bugFixes[0], success, taskContext);
    }
    
    // Learn next-action patterns
    const nextTasks = suggestNextTasks([taskName], taskContext);
    for (const next of nextTasks) {
      learner.learn(taskName, next, true, taskContext);
    }
  } catch {
    // Silently fail - pattern learning is optional
  }
}

/**
 * Get comprehensive task summary
 */
export function getTaskSummary(
  completedTasks: string[],
  projectContext?: string,
  recentDiff?: string
): TaskSummary {
  const analysis = recentDiff ? extractKeyChanges(recentDiff) : null;
  
  return {
    summary: analysis ? generateSummary(analysis) : completedTasks.slice(0, 3).join(', '),
    keyChanges: analysis?.addedFeatures || [],
    suggestions: suggestNextTasks(completedTasks, projectContext),
    patterns: [],
  };
}
