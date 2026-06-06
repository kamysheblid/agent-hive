import { describe, it, expect } from 'bun:test';
import { createNsModeState, detectNsMode, getNsDirective } from './ns-mode.js';

describe('NsModeState', () => {
  it('starts inactive', () => {
    const state = createNsModeState();
    expect(state.active).toBe(false);
  });

  it('activates and deactivates', () => {
    const state = createNsModeState();
    state.activate();
    expect(state.active).toBe(true);
    state.deactivate();
    expect(state.active).toBe(false);
  });
});

describe('detectNsMode', () => {
  it('detects $ns at start', () => {
    expect(detectNsMode('$ns implement this')).toBe(true);
  });

  it('detects $ns mid-text', () => {
    expect(detectNsMode('please $ns implement this')).toBe(true);
  });

  it('does not trigger on plain text', () => {
    expect(detectNsMode('implement this')).toBe(false);
  });

  it('does not trigger on ns without $', () => {
    expect(detectNsMode('ns implement this')).toBe(false);
  });

  it('is case-sensitive to $ns only', () => {
    expect(detectNsMode('$NS implement this')).toBe(false);
  });

  it('handles empty text', () => {
    expect(detectNsMode('')).toBe(false);
  });
});

describe('getNsDirective', () => {
  it('returns directive with key sections', () => {
    const directive = getNsDirective();
    expect(directive).toContain('TDD');
    expect(directive).toContain('RED→GREEN');
    expect(directive).toContain('Verification gate');
    expect(directive).toContain('$ns MODE ACTIVE');
  });
});
