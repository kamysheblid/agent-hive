/**
 * User Profile Learning — periodic AI analysis of user preferences.
 *
 * Pattern sourced from tickernelz/opencode-mem.
 * Analyzes user messages in batches to identify preferences, patterns, and workflows.
 * Uses the connected OpenCode provider — no extra API keys or data storage.
 *
 * Privacy: opt-in only (enabled: false by default).
 * No raw messages stored permanently — only analyzed summaries persist.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { OpenCodeProviderService } from './opencode-provider.js';
import { buildProfileAnalysisPrompt, parseProfileAnalysisResponse } from '../utils/profile-prompt.js';

export interface UserProfileConfig {
  enabled?: boolean;
  analysisInterval?: number;
  maxPreferences?: number;
  confidenceDecayDays?: number;
}

export interface UserPreference {
  key: string;
  value: string;
  confidence: number;
  category: 'code-style' | 'communication' | 'tool' | 'workflow' | 'preference';
  firstSeen: string;
  lastUpdated: string;
}

export interface UserProfileData {
  preferences: UserPreference[];
  detectedPatterns: string[];
  lastAnalysis: string | null;
  version: number;
}

const DEFAULT_ANALYSIS_INTERVAL = 10;
const DEFAULT_MAX_PREFERENCES = 20;
const DEFAULT_CONFIDENCE_DECAY_DAYS = 30;

/**
 * Service that periodically analyzes user messages to build a preference profile.
 * Uses the existing OpenCodeProviderService for LLM calls — no extra API keys.
 */
export class UserProfileService {
  private messageCount = 0;
  private profile: UserProfileData;
  private profilePath: string;
  private config: UserProfileConfig;
  private opencodeProvider: OpenCodeProviderService;
  private recentMessages: string[] = [];

  constructor(
    config: UserProfileConfig,
    opencodeProvider: OpenCodeProviderService,
    profileDir: string,
  ) {
    this.config = config;
    this.opencodeProvider = opencodeProvider;
    this.profilePath = path.join(profileDir, '.hive', 'profile.json');
    this.profile = this.loadProfile();
  }

  /**
   * Called on each user message. Tracks message count and triggers
   * periodic analysis when analysisInterval is reached.
   * 0-risk: never throws.
   */
  async onUserMessage(text: string): Promise<void> {
    // 0-risk guard
    if (!this.isEnabled()) return;

    try {
      this.messageCount++;
      this.recentMessages.push(text);

      // Keep recent messages bounded
      if (this.recentMessages.length > (this.config.analysisInterval ?? DEFAULT_ANALYSIS_INTERVAL) * 2) {
        this.recentMessages = this.recentMessages.slice(-(this.config.analysisInterval ?? DEFAULT_ANALYSIS_INTERVAL));
      }

      // Check if analysis interval reached
      const interval = this.config.analysisInterval ?? DEFAULT_ANALYSIS_INTERVAL;
      if (this.messageCount >= interval) {
        this.messageCount = 0;
        await this.analyzeAndUpdate();
      }
    } catch (error) {
      // 0-risk: never throw
      console.warn(
        '[user-profile] onUserMessage failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Run profile analysis and merge results.
   */
  private async analyzeAndUpdate(): Promise<void> {
    try {
      const { systemPrompt, userPrompt } = buildProfileAnalysisPrompt(this.recentMessages);

      const result = await this.opencodeProvider.generateStructured<{
        preferences: Array<{ key: string; value: string; confidence: number; category: string }>;
        detected_patterns: string[];
      }>({
        systemPrompt,
        userPrompt,
        expectedFields: ['preferences'],
      });

      if (!result?.preferences) return;

      // Merge preferences
      const now = new Date().toISOString();

      for (const newPref of result.preferences) {
        if (newPref.confidence < 0.6) continue; // Skip low-confidence

        const existing = this.profile.preferences.find(p => p.key === newPref.key);

        if (existing) {
          // Update existing preference
          existing.value = newPref.value;
          existing.confidence = Math.max(existing.confidence, newPref.confidence);
          existing.category = newPref.category as UserPreference['category'];
          existing.lastUpdated = now;
        } else {
          // Add new preference
          this.profile.preferences.push({
            key: newPref.key,
            value: newPref.value,
            confidence: newPref.confidence,
            category: newPref.category as UserPreference['category'],
            firstSeen: now,
            lastUpdated: now,
          });
        }
      }

      // Merge detected patterns
      if (result.detected_patterns) {
        for (const pattern of result.detected_patterns) {
          if (!this.profile.detectedPatterns.includes(pattern)) {
            this.profile.detectedPatterns.push(pattern);
          }
        }
      }

      // Apply confidence decay
      this.applyConfidenceDecay();

      // Prune to max preferences
      const maxPrefs = this.config.maxPreferences ?? DEFAULT_MAX_PREFERENCES;
      if (this.profile.preferences.length > maxPrefs) {
        // Sort by confidence (descending) and keep top N
        this.profile.preferences.sort((a, b) => b.confidence - a.confidence);
        this.profile.preferences = this.profile.preferences.slice(0, maxPrefs);
      }

      this.profile.lastAnalysis = now;
      this.profile.version++;

      // Save profile
      this.saveProfile();
    } catch (error) {
      console.warn(
        '[user-profile] analyzeAndUpdate failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Apply confidence decay based on time since last update.
   * Older preferences lose confidence.
   */
  private applyConfidenceDecay(): void {
    const decayDays = this.config.confidenceDecayDays ?? DEFAULT_CONFIDENCE_DECAY_DAYS;
    const now = Date.now();
    const decayMs = decayDays * 24 * 60 * 60 * 1000;

    for (const pref of this.profile.preferences) {
      const lastUpdated = new Date(pref.lastUpdated).getTime();
      const age = now - lastUpdated;

      if (age > decayMs) {
        // Halve confidence for each decay period elapsed
        const periodsElapsed = Math.floor(age / decayMs);
        const decay = Math.pow(0.5, periodsElapsed);
        pref.confidence = pref.confidence * decay;

        // Remove preferences below threshold
        if (pref.confidence < 0.1) {
          pref.confidence = 0;
        }
      }
    }

    // Remove zero-confidence preferences
    this.profile.preferences = this.profile.preferences.filter(p => p.confidence > 0);
  }

  /**
   * Get profile context for system prompt injection.
   * Returns empty string if no profile exists or disabled.
   */
  getProfileInjection(): string {
    if (!this.isEnabled()) return '';
    if (!this.profile || this.profile.preferences.length === 0) {
      return '';
    }

    const lines: string[] = ['<user_profile>'];

    // Group by category
    const categories = new Map<string, UserPreference[]>();
    for (const pref of this.profile.preferences) {
      const cat = categories.get(pref.category) || [];
      cat.push(pref);
      categories.set(pref.category, cat);
    }

    for (const [category, prefs] of categories) {
      lines.push(`  [${category}]`);
      for (const pref of prefs) {
        if (pref.confidence >= 0.6) {
          lines.push(`    ${pref.key}: ${pref.value}`);
        }
      }
    }

    if (this.profile.detectedPatterns.length > 0) {
      lines.push('');
      lines.push('  patterns: ' + this.profile.detectedPatterns.slice(0, 5).join(', '));
    }

    lines.push('</user_profile>');

    return lines.join('\n');
  }

  /**
   * Load profile from disk.
   */
  private loadProfile(): UserProfileData {
    try {
      if (fs.existsSync(this.profilePath)) {
        const raw = fs.readFileSync(this.profilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          preferences: parsed.preferences || [],
          detectedPatterns: parsed.detectedPatterns || [],
          lastAnalysis: parsed.lastAnalysis || null,
          version: parsed.version || 0,
        };
      }
    } catch {
      // File missing or corrupt — start fresh
    }
    return {
      preferences: [],
      detectedPatterns: [],
      lastAnalysis: null,
      version: 0,
    };
  }

  /**
   * Save profile to disk.
   */
  private saveProfile(): void {
    try {
      fs.mkdirSync(path.dirname(this.profilePath), { recursive: true });
      fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2), 'utf-8');
    } catch (error) {
      console.warn(
        '[user-profile] Failed to save profile:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Reset message counter (for testing).
   */
  resetMessageCount(): void {
    this.messageCount = 0;
  }

  private isEnabled(): boolean {
    return this.config?.enabled === true;
  }
}
