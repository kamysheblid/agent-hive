/**
 * Auto-recall and auto-capture utilities for vector memory.
 *
 * These formatting helpers are extracted from the plugin hooks (index.ts)
 * so they can be unit-tested independently.
 */

import type { SearchResult } from '../services/vector-memory.js';

/**
 * Format a list of vector memory search results into a system prompt section
 * for auto-recall injection.
 *
 * @param results - Vector memory search results
 * @param maxContentLength - Maximum content length per entry before truncation (default: 300)
 * @returns Formatted string ready for system prompt injection, or empty string if no results
 */
export function formatAutoRecallInjection(
  results: SearchResult[],
  maxContentLength: number = 300,
): string {
  if (!results || results.length === 0) {
    return '';
  }

  const sections: string[] = [];
  sections.push('### Auto-Recalled Vector Memories');
  sections.push('');
  sections.push('_Semantically relevant memories from previous sessions. Use hive_vector_add to store new memories._');
  sections.push('');

  for (const mem of results) {
    const labels: string[] = [];
    if (mem.metadata.type) labels.push(`[${mem.metadata.type}]`);
    if (mem.metadata.scope) labels.push(`(${mem.metadata.scope})`);
    const labelStr = labels.length > 0 ? labels.join(' ') + ' ' : '';
    // Truncate content if too long
    const content = mem.content.length > maxContentLength
      ? mem.content.slice(0, maxContentLength) + '...'
      : mem.content;
    sections.push(`- ${labelStr}${content}`);
  }

  return sections.join('\n');
}

/**
 * Build a session snapshot summary string for auto-capture.
 *
 * @param featureName - Name of the active feature
 * @param featureStatus - Status of the feature
 * @param doneTasks - Number of completed tasks
 * @param totalTasks - Total number of tasks
 * @param pendingTaskNames - Names of pending/in-progress tasks (optional)
 * @returns Formatted snapshot content string
 */
export function buildCaptureSnapshot(
  featureName: string,
  featureStatus: string,
  doneTasks: number,
  totalTasks: number,
  pendingTaskNames?: string[],
): string {
  const parts: string[] = [
    `Session snapshot for feature "${featureName}" (${featureStatus})`,
    `Tasks: ${doneTasks}/${totalTasks} completed`,
  ];
  if (pendingTaskNames && pendingTaskNames.length > 0) {
    parts.push(`Pending: ${pendingTaskNames.join(', ')}`);
  }
  parts.push(`Captured: ${new Date().toISOString()}`);
  return parts.join('\n');
}
