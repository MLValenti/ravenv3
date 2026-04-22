# Stabilization Notes

## Root Causes Found

Raven's conversational drift was coming from overlapping state ownership instead of one bad classifier.

- `app/session/SessionClient.tsx` was acting as a second state machine for request ownership, visible assistant commit state, replay dedupe, skipped-render recovery, and per-turn request guards.
- `app/api/chat/route.ts` already had a contract seam through `lib/session/session-state-contract.ts`, but the client-side visible output path was still managed outside that contract.
- `lib/session/response-gate.ts` was compensating for stale mode inheritance and bad commit ordering instead of only enforcing hard invariants.
- Stale structured context could keep deterministic rails alive after the user's turn had plainly shifted back to open conversation.

## Current Turn Pipeline Map

### User intent classification

- Client live turn acceptance: `app/session/SessionClient.tsx`
  - `classifyUserIntent(...)`
  - `classifyDialogueRoute(...)`
  - `reduceUserTurn(...)`
- Server route replay path: `app/api/chat/route.ts`
  - `reduceUserTurn(...)`
  - `interpretLiveRouteTurn(...)`

### Scene lock and replay reconstruction

- `lib/session/live-turn-controller.ts`
  - `maybeHandleSessionReplayDeterministicBypass(...)`
  - `replaySceneFromMessages(...)`
- `lib/session/scene-state.ts`
  - `noteSceneStateUserTurn(...)`
  - `noteSceneStateAssistantTurn(...)`
- `lib/session/conversation-runtime.ts`
  - `reconcileSceneStateWithConversation(...)`

### Deterministic bypass decision

- `lib/session/deterministic-scene-routing.ts`
  - `shouldBypassModelForSceneTurn(...)`
  - `explainBypassModelForSceneTurn(...)`
- Client-side contract preference:
  - `lib/session/live-turn-integrity.ts`
  - `shouldPreferServerTurnContract(...)`

### Response repair and fallback replacement

- `lib/session/scene-scaffolds.ts`
  - scene-aware deterministic candidates
- `lib/session/scene-state.ts`
  - `buildSceneFallback(...)`
- `lib/session/response-gate.ts`
  - final invariant enforcement and rescue only

### Final visible output scrub

- Client:
  - `app/session/SessionClient.tsx`
  - `prepareSessionVisibleOutput(...)`
- Shared scrub:
  - `lib/session/live-turn-integrity.ts`
  - `sanitizeSessionVisibleAssistantText(...)`
  - `lib/session/response-gate.ts`
  - `scrubVisibleInternalLeakText(...)`

### Assistant turn dedupe and commit

- Canonical contract state:
  - `lib/session/session-state-contract.ts`
- Runtime commit guards:
  - `lib/session/assistant-turn-guard.ts`
- Client commit entry point:
  - `app/session/SessionClient.tsx`
  - `appendRavenOutput(...)`
  - `recoverSkippedAssistantRender(...)`

## What Changed

### 1. Assistant request and visible commit ownership moved under the session contract

`lib/session/session-state-contract.ts` now includes `assistantRuntime`, which owns:

- in-flight turn requests
- in-flight model requests
- finalize dedupe
- authoritative visible commit tracking
- replay dedupe
- append-only visible assistant turn log

The client now uses contract reducers instead of directly mutating several separate refs for those concerns.

### 2. Visible assistant commits are now ordered and idempotent through one runtime

`lib/session/assistant-turn-guard.ts` now exposes a typed runtime state and reducers for:

- request start and finish
- finalize registration
- visible assistant commit
- accepted-turn cleanup

That means a second response for the same user turn cannot silently replace the first committed visible output.

### 3. Fresh conversational turns can break stale game and profile locks

`lib/session/deterministic-scene-routing.ts` now releases stale deterministic locks when the user turn is clearly fresh open conversation, including:

- greetings
- casual smalltalk
- assistant-self questions
- mutual get-to-know turns
- direct casual questions that do not match the active game or profile thread

Game continuity still holds when the turn actually looks like a game move or game follow-up.

### 4. Runtime artifact hygiene tightened

`.gitignore` now excludes local runtime artifacts such as sqlite databases, pid files, wav output, and temp folders so the repo does not keep drifting from local test/session data.

## Why The New Ownership Model Is Safer

- There is one contract state for assistant request ownership instead of parallel client refs.
- Visible output dedupe and stale-response blocking happen before UI append, not after recovery heuristics have already diverged.
- Replay protection and visible commit ordering share the same runtime state.
- Fresh-turn breakout is determined earlier, so the response gate no longer has to repair as much stale-scene damage downstream.

## Tests Added Or Updated

- `tests/session-state-contract.test.ts`
  - assistant request ownership lives in contract state
  - duplicate visible commit is blocked
  - finalize registration is idempotent
- `tests/deterministic-scene-routing.test.ts`
  - stale game lock releases on fresh casual question
  - stale profile lock releases on fresh casual question
  - real game moves still stay on the active game

Updated expectations:

- `tests/conversation-quality.test.ts`
- `tests/session-ui-harness.test.ts`
- `tests/open-question.test.ts`
- `tests/weak-input-replies.test.ts`
- `lib/chat/regression-scenarios.ts`

## Remaining Known Risks

- `app/session/SessionClient.tsx` is still too large and still owns network orchestration plus diagnostics in one file.
- `app/api/chat/route.ts` remains orchestration-heavy, even though more ownership now lives in library seams.
- The response gate is narrower than before, but it still contains more content-aware shaping than ideal for a final architecture.
