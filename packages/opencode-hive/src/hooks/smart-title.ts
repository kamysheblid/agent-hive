/**
 * Smart Session Title Plugin
 * 
 * Auto-generates meaningful session titles based on conversation content.
 * Based on: https://github.com/Tarquinen/opencode-smart-title
 * 
 * Note: This is a simplified version that uses heuristics.
 * Full AI-based title generation can be added later.
 */

import type { Event } from '@opencode-ai/sdk';

// Track idle count per session for threshold-based updates
const sessionIdleCount = new Map<string, number>();

// Track first user message per session for title generation
const sessionFirstMessage = new Map<string, string>();

/**
 * Extract a title from user message using heuristics
 */
function extractTitleFromMessage(message: string): string {
  if (!message) return 'Untitled session';
  
  let cleaned = message.trim();
  cleaned = cleaned.replace(/^(user[:\s]*|human[:\s]*|hi[,!\s]*|hello[,!\s]*|hey[,!\s]*)/i, '');
  
  if (cleaned.length > 50) {
    cleaned = cleaned.slice(0, 47) + '...';
  }
  
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return cleaned || 'Untitled session';
}

/**
 * Generate title using simple heuristics
 */
function generateTitle(firstMessage: string): string {
  return extractTitleFromMessage(firstMessage);
}

export interface SmartTitleConfig {
  enabled?: boolean;
  updateThreshold?: number;
}

export function createSmartTitleHandler(config: SmartTitleConfig) {
  const threshold = config?.updateThreshold ?? 1;
  
  return async (input: { event: Event }) => {
    if (!config?.enabled) return;
    
    const event = input.event as { type: string; properties?: Record<string, unknown> };
    
    // Handle session.idle event
    if (event.type === 'session.idle') {
      const sessionID = event.properties?.sessionID as string | undefined;
      if (!sessionID) return;
      
      // Skip subagent sessions
      if (sessionID.includes('-worker-') || sessionID.includes('-sub-')) return;
      
      // Increment idle count
      const currentCount = (sessionIdleCount.get(sessionID) || 0) + 1;
      sessionIdleCount.set(sessionID, currentCount);
      
      // Only update if threshold reached
      if (currentCount % threshold !== 0) return;
      
      // Get first message for title generation
      const firstMessage = sessionFirstMessage.get(sessionID);
      if (firstMessage) {
        const title = generateTitle(firstMessage);
        console.log(`[hive:smart-title] Title for ${sessionID}: "${title}"`);
        // Note: Full implementation would update session via client API
      }
    }
    
    // Handle new user messages to capture first message
    if (event.type === 'message.created' || event.type === 'message-part.created') {
      const sessionID = event.properties?.sessionID as string | undefined;
      const role = event.properties?.role as string | undefined;
      const content = event.properties?.content as string | undefined;
      
      if (sessionID && role === 'user' && content && !sessionFirstMessage.has(sessionID)) {
        sessionFirstMessage.set(sessionID, content);
      }
    }
  };
}

export function clearSessionData(sessionID: string): void {
  sessionIdleCount.delete(sessionID);
  sessionFirstMessage.delete(sessionID);
}
