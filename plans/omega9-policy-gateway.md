# Add OMEGA-9 policy gateway before tool execution

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `PLANS.md` at the repository root.

## Purpose / Big Picture

After this change, OMEGA-9 can apply a single policy decision before an agent tool is executed. The initial implementation will be additive and fail-closed for policy errors. Read-only operations may proceed when policy allows them, while operations classified as requiring approval will surface through the Agents SDK approval/interruption path rather than introducing a separate pause/resume engine. The behavior will be observable through focused unit tests around tool execution and approval routing.

## Progress

- [x] (2026-09-04 08:54Z) Identified `agents-core` as the orchestration and tool-approval boundary and confirmed existing SDK support for guardrails, approvals, MCP, RunState, tracing, and Realtime.
- [x] (2026-09-04 08:55Z) Created feature branch `feat/omega9-policy-gateway` from `main`.
- [ ] Locate the narrowest existing tool execution hook and canonical tool identity helpers that can host policy evaluation without duplicating routing logic.
- [ ] Define an internal policy decision interface with `allow`, `require_approval`, and `deny` outcomes plus structured reason metadata.
- [ ] Integrate policy evaluation into the tool execution lifecycle before side effects occur.
- [ ] Map `require_approval` to the existing Agents SDK approval/interruption mechanism and ensure resume semantics remain native to RunState.
- [ ] Add focused tests proving allow, approval-required, deny, and policy-error fail-closed behavior.
- [ ] Run repository-mandated implementation strategy, code verification, changeset validation, and PR draft summary workflows before handoff.

## Surprises & Discoveries

- Observation: The repository already separates generic orchestration (`agents-core`) from OpenAI-specific bindings (`agents-openai`) and Realtime (`agents-realtime`), so OMEGA-9 policy should remain provider-agnostic in core.
  Evidence: Package layout and repository contributor guidance.
- Observation: The repository already has a native approval lifecycle and durable RunState semantics. A separate OMEGA-9 pause/resume engine would create unnecessary duplication and drift risk.
  Evidence: Repository guidance for tool execution/approval lifecycle and RunState resume.

## Decision Log

- Decision: Implement the first OMEGA-9 governance hook in `agents-core`, not in `agents-openai`.
  Rationale: Tool authorization is an orchestration concern that should apply consistently across OpenAI, MCP, hosted, and function tools.
  Date/Author: 2026-09-04 / OpenAI assistant

- Decision: Reuse the Agents SDK approval/interruption and RunState mechanisms for `require_approval` outcomes.
  Rationale: This preserves existing pause/resume semantics, handoff behavior, tracing, and serialization instead of introducing a parallel approval engine.
  Date/Author: 2026-09-04 / OpenAI assistant

- Decision: Default policy evaluation failures to deny/fail-closed in the first implementation.
  Rationale: The requested governance model prioritizes preventing unreviewed side effects when authorization state is uncertain.
  Date/Author: 2026-09-04 / OpenAI assistant

## Outcomes & Retrospective

Work has started. The architecture target and implementation branch are established; runtime code has not yet been modified.

## Context and Orientation

The repository is a pnpm-managed TypeScript monorepo. `packages/agents-core` contains the provider-neutral agent runtime and is the correct location for generic policy enforcement. `packages/agents-openai` binds that runtime to OpenAI APIs. `packages/agents-realtime` handles low-latency voice sessions. The repository guidance identifies `packages/agents-core/src/run.ts` as the runtime entrypoint while preferring new execution logic under `packages/agents-core/src/runner/`. Existing helper modules under core own canonical tool identity, routing, approvals, guardrails, concurrency, timeouts, hooks, and failure conversion.

For this plan, a policy gateway means a small provider-neutral decision point invoked immediately before a tool would execute. It does not itself perform external authorization calls or side effects. It consumes normalized context and returns one of three outcomes: allow execution, require the existing SDK approval path, or deny execution.

## Plan of Work

First, inspect the core runner modules responsible for selecting a tool, resolving canonical tool identity, checking existing approval state, and invoking the tool. The policy hook must be inserted after the tool and call are identified but before the function, MCP operation, hosted tool, or nested-agent tool can produce side effects.

Next, add a minimal internal policy contract under `packages/agents-core/src/runner/` or the nearest existing tool-execution module. The contract should carry normalized tool identity, call identity, agent identity, run context, and any existing approval metadata required for a deterministic decision. Its result should be a discriminated union with `allow`, `require_approval`, and `deny`. Avoid OMEGA-9 brand-specific naming in exported public APIs unless a public extension point is explicitly required; the first implementation should prefer an internal generic policy primitive that OMEGA-9 can configure.

Then, wire the policy result into the existing execution lifecycle. `allow` continues normally. `require_approval` must reuse the repository's existing approval/interruption representation. `deny` must terminate or convert the tool attempt using the canonical failure path without invoking the underlying side-effecting tool. Any unexpected policy exception must be converted to a deny/fail-closed outcome with traceable reason metadata and without leaking secrets.

Finally, add focused regression tests at the tool execution boundary. Tests must prove that allowed tools execute exactly once, approval-required tools do not execute until approved through existing RunState semantics, denied tools never execute, and policy errors never execute the tool. Where streaming and non-streaming paths share separate machinery, verify parity or prove they share the same guarded execution function.

## Concrete Steps

Work from the repository root on branch `feat/omega9-policy-gateway`.

Inspect relevant core files and references, especially the repository's tool identity/routing and tool execution/approval lifecycle guidance. Locate the function that performs the final transition from a normalized tool call to actual invocation.

Before changing runtime code, run the repository's required implementation strategy workflow. Keep this ExecPlan updated with any compatibility decisions.

Implement the policy decision type and hook at the narrowest shared execution point. Add tests beside the existing core tool execution tests.

Run the repository's required verification sequence, including build, targeted tests, full mandated code verification, and changeset validation when package files are changed. Generate the required PR draft summary only after verification is complete.

## Validation and Acceptance

Acceptance requires observable behavior, not only types compiling.

A focused unit test must show an allowed tool increments a test counter exactly once and returns its normal output.

A focused unit test must show a `require_approval` decision creates the same interruption/approval behavior as an ordinary approval-required tool and does not increment the side-effect counter before approval. Resuming the approved RunState must execute the tool once.

A focused unit test must show a denied tool returns the canonical blocked/failure result and leaves the side-effect counter at zero.

A focused unit test must show a thrown or rejected policy evaluation fails closed and leaves the side-effect counter at zero.

Repository build, lint/type checks, relevant package tests, and mandatory verification workflows must pass before the implementation is considered complete.

## Idempotence and Recovery

The change is additive and must not mutate external state during tests. Test tools should use in-memory counters or fixtures only. If the new hook causes regressions, remove the hook wiring while leaving the policy type/tests isolated, then reintroduce it at a narrower shared execution boundary. Do not bypass existing approval serialization or RunState behavior.

## Artifacts and Notes

Initial architecture evidence:

    OMEGA-9 policy -> agents-core execution boundary -> existing SDK approval/RunState -> tool invocation

No runtime code has been changed yet.

## Interfaces and Dependencies

The implementation should prefer a small internal TypeScript discriminated union similar in shape to:

    type ToolPolicyDecision =
      | { outcome: 'allow'; reason?: string }
      | { outcome: 'require_approval'; reason?: string }
      | { outcome: 'deny'; reason: string };

The evaluator should receive normalized core runtime context rather than provider-specific request objects. It must not require `agents-openai` in `agents-core`.

The final location and function signature will be chosen after inspecting the existing runner and approval interfaces so the change composes with canonical tool identity, tool routing, tracing, and RunState serialization.

Revision note: 2026-09-04. Initial ExecPlan created to establish the OMEGA-9 policy-gateway implementation path before runtime changes, in accordance with repository planning requirements.
