import { describe, expect, it } from 'vitest';

import { RunContext } from '../../src/runContext';
import {
  evaluateToolExecutionPolicy,
  type ToolPolicyInput,
} from '../../src/runner/toolPolicy';

function policyInput(): ToolPolicyInput {
  return {
    toolName: 'crm.lookup_account',
    callId: 'call-1',
    input: { accountId: 'acct-1' },
    runContext: new RunContext(),
    agentName: 'Policy test agent',
  };
}

describe('evaluateToolExecutionPolicy', () => {
  it('allows execution when no policy is configured', async () => {
    await expect(
      evaluateToolExecutionPolicy(undefined, policyInput()),
    ).resolves.toEqual({ outcome: 'allow' });
  });

  it('preserves allow decisions', async () => {
    await expect(
      evaluateToolExecutionPolicy(
        async () => ({ outcome: 'allow', reason: 'read-only operation' }),
        policyInput(),
      ),
    ).resolves.toEqual({
      outcome: 'allow',
      reason: 'read-only operation',
    });
  });

  it('preserves approval-required decisions', async () => {
    await expect(
      evaluateToolExecutionPolicy(
        async () => ({
          outcome: 'require_approval',
          reason: 'mutation requires human approval',
        }),
        policyInput(),
      ),
    ).resolves.toEqual({
      outcome: 'require_approval',
      reason: 'mutation requires human approval',
    });
  });

  it('preserves explicit deny decisions', async () => {
    await expect(
      evaluateToolExecutionPolicy(
        async () => ({ outcome: 'deny', reason: 'operation blocked' }),
        policyInput(),
      ),
    ).resolves.toEqual({ outcome: 'deny', reason: 'operation blocked' });
  });

  it('fails closed when policy evaluation throws', async () => {
    await expect(
      evaluateToolExecutionPolicy(async () => {
        throw new Error('policy backend unavailable');
      }, policyInput()),
    ).resolves.toEqual({
      outcome: 'deny',
      reason: 'Tool execution denied because policy evaluation failed.',
    });
  });

  it('fails closed when a policy returns an invalid decision', async () => {
    await expect(
      evaluateToolExecutionPolicy(
        async () => ({ outcome: 'unknown' }) as never,
        policyInput(),
      ),
    ).resolves.toEqual({
      outcome: 'deny',
      reason: 'Tool execution denied because policy returned an invalid decision.',
    });
  });
});
