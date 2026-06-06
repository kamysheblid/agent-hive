/**
 * $ns Mode — Directive and State
 *
 * Inspired by oh-my-openagent's Ultrawork mode.
 * Detects "$ns" keyword in user messages and injects a
 * maximum-rigor directive into the system prompt.
 *
 * 0-risk: all exports are pure functions or lightweight state objects.
 */

export interface NsModeState {
  /** Whether $ns mode is active for the next system prompt injection */
  active: boolean;
  /** Activate $ns mode */
  activate: () => void;
  /** Deactivate $ns mode (call after injection) */
  deactivate: () => void;
}

export function createNsModeState(): NsModeState {
  let active = false;
  return {
    get active() {
      return active;
    },
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
    },
  };
}

/**
 * Detect $ns keyword in user text.
 * Pattern: $ns at word boundary (e.g., "$ns do X" or "enable $ns mode")
 */
export function detectNsMode(text: string): boolean {
  return /\$ns\b/.test(text);
}

/**
 * Get the $ns mode directive.
 * Injected into the system prompt when $ns mode is active.
 */
export function getNsDirective(): string {
  return `

## $ns Mode — Maximum Rigor

$ns mode is ACTIVE. Follow these rules:

### Workflow
1. **TDD is MANDATORY**: Write failing test FIRST (RED), then minimal code (GREEN)
2. **Manual verification**: After tests pass, verify with a real command (curl, run, etc.)
3. **Durable notepad**: Maintain a notepad section in your response tracking:
   - ## Plan — every step
   - ## Now — current step
   - ## Todo — remaining steps
4. **RED→GREEN evidence**: Always show RED output before GREEN output
5. **Verification gate**: Run full test suite + build before declaring done

### Constraints
- No implementation before failing test
- No "tests pass" as sole completion proof — show surface-level evidence
- No @ts-ignore / @ts-expect-error / as any
- Smallest correct change. No drive-by refactors.
- Parallel independent work where possible

### Output Discipline
First user-visible line: "$ns MODE ACTIVE!"
After that: state changes only (RED/GREEN evidence, verification results)
Final: outcome + success checklist + evidence references

### Stop Rules
Stop ONLY when:
- Every acceptance criterion has RED→GREEN evidence
- Full test suite passes
- Build succeeds
- All changes committed
`;
}
