# Stabilization Notes

## Milestone 1 root cause addressed

Ordinary user turns still had split conversational authority.

- `SessionClient` could locally classify, scaffold, rescue, and render ordinary conversation turns.
- The server could also interpret and answer the same turn through the canonical `/api/chat` path.
- That meant one normal user message could be shaped by both client and server logic, which made stale task or game residue harder to reason about and made late responses harder to contain safely.

This milestone narrows ordinary turn handling so the server owns normal chat, clarification, and revision-continuation replies, while the client only renders the accepted result and maintains local runtime bookkeeping.

## Files changed

- `app/session/SessionClient.tsx`
- `lib/session/live-turn-integrity.ts`
- `lib/session/assistant-turn-guard.ts`
- `tests/live-turn-integrity.test.ts`
- `tests/session-state-contract.test.ts`
- `tests/session-acceptance.test.ts`
- `tests/deterministic-scene-routing.test.ts`

## Tests added or changed

- Added explicit ownership tests for latest-turn response acceptance in `tests/live-turn-integrity.test.ts`
- Added visible-output scaffold leak sanitization coverage in `tests/live-turn-integrity.test.ts`
- Added stale older visible commit blocking in `tests/session-state-contract.test.ts`
- Added direct-question and clarification acceptance checks in `tests/session-acceptance.test.ts`
- Added explicit stale task and stale game casual-turn routing checks in `tests/deterministic-scene-routing.test.ts`

## Remaining risks for Milestone 2

- `SessionClient` still contains large amounts of dormant local conversational fallback and recovery logic that should be removed or isolated further.
- The server path is now the primary owner for ordinary turns, but there are still multiple overlapping state representations across conversation, working memory, and scene state.
- `live-turn-controller` and `response-gate` still do more content shaping than ideal for a final architecture.
- Some client-side recovery hooks remain for specialty or stalled flows and should be narrowed further once the canonical state contract is expanded.
