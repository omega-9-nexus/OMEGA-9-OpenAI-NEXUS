import type { RunContext } from '../runContext';
import type { UnknownContext } from '../types';

export type ToolPolicyDecision =
  | { outcome: 'allow'; reason?: string }
  | { outcome: 'require_approval'; reason?: string }
  | { outcome: 'deny'; reason: string };

export type ToolPolicyInput<TContext = UnknownContext> = {
  /** Canonical qualified tool identity used by approval routing. */
  toolName: string;
  /** Stable provider/tool call identifier for this invocation. */
  callId: string;
  /** Parsed tool input, after schema validation when available. */
  input: unknown;
  /** Active run context. */
  runContext: RunContext<TContext>;
  /** Agent requesting the tool invocation. */
  agentName: string;
};

export type ToolExecutionPolicy<TContext = UnknownContext> = (
  input: ToolPolicyInput<TContext>,
) => ToolPolicyDecision | Promise<ToolPolicyDecision>;

const POLICY_EVALUATION_FAILED_REASON =
  'Tool execution denied because policy evaluation failed.';
const INVALID_POLICY_DECISION_REASON =
  'Tool execution denied because policy returned an invalid decision.';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeDecision(value: unknown): ToolPolicyDecision {
  if (typeof value !== 'object' || value === null || !('outcome' in value)) {
    return { outcome: 'deny', reason: INVALID_POLICY_DECISION_REASON };
  }

  const decision = value as {
    outcome?: unknown;
    reason?: unknown;
  };

  if (decision.outcome === 'allow') {
    return isNonEmptyString(decision.reason)
      ? { outcome: 'allow', reason: decision.reason }
      : { outcome: 'allow' };
  }

  if (decision.outcome === 'require_approval') {
    return isNonEmptyString(decision.reason)
      ? { outcome: 'require_approval', reason: decision.reason }
      : { outcome: 'require_approval' };
  }

  if (decision.outcome === 'deny') {
    return {
      outcome: 'deny',
      reason: isNonEmptyString(decision.reason)
        ? decision.reason
        : INVALID_POLICY_DECISION_REASON,
    };
  }

  return { outcome: 'deny', reason: INVALID_POLICY_DECISION_REASON };
}

/**
 * Evaluates a tool policy using fail-closed semantics.
 *
 * Policy exceptions and malformed decisions are converted into `deny` decisions so
 * execution code never has to choose between proceeding and handling an unknown
 * authorization state.
 */
export async function evaluateToolExecutionPolicy<TContext = UnknownContext>(
  policy: ToolExecutionPolicy<TContext> | undefined,
  input: ToolPolicyInput<TContext>,
): Promise<ToolPolicyDecision> {
  if (!policy) {
    return { outcome: 'allow' };
  }

  try {
    return normalizeDecision(await policy(input));
  } catch {
    return { outcome: 'deny', reason: POLICY_EVALUATION_FAILED_REASON };
  }
}
