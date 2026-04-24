# Semantic Response Path Ownership

Raven v3 uses
`interpretTurnMeaning -> updateCanonicalTurnState -> planSemanticResponse -> selectEligibleDomainHandler -> planDomainAnswer`
as the owner of conversational move selection, facet selection, handler
eligibility, and domain answer contracts.

## Replaced by Semantic Planner

- `lib/chat/open-question.ts`
  - Assistant self-disclosure, assistant preference questions, reciprocal offers,
    preference application requests, definition answers, and factual answers now enter
    through `buildSemanticPlannedReply`, then `realizeSemanticContent`.
  - Raven preference/self-disclosure content is grounded in
    `lib/session/raven-preferences.ts`; `lib/session/raven-profile.ts` is a
    compatibility wrapper around that source.
- `lib/session/raven-preferences.ts`
  - Owns Raven preference facts, facet-aware answer plans, answer contracts, and
    validation for category overviews, favorites, list expansion, yes/no item
    questions, binary comparisons, item reasons, explicitly modeled tool
    availability boundaries, clarifying enumerations, invitations, application
    requests, and challenges.
- `lib/session/turn-meaning.ts`
  - Owns requested facets, primary/secondary subjects, required answer slots,
    handler eligibility decisions, and rejected-handler trace data. A broad
    domain match is not enough for a handler to answer.
- `lib/session/scene-scaffolds.ts`
  - Open-chat semantic turns such as greetings, Raven preference questions,
    reciprocal probes, and user-preference application requests are routed through
    `buildSemanticOpenReply` before generic scene scaffolds can answer.
- `lib/session/response-gate.ts`
  - Response traces are built from `updateCanonicalTurnState`; the gate can reject
    malformed output, but it does not choose a new semantic move.
  - Semantic traces include requested facet, required answer slots, eligible and
    rejected handlers, chosen handler, and answer-contract validation result.
- `app/api/chat/route.ts`
  - API debug headers use `updateCanonicalTurnState` so live route traces expose
    the same `TurnMeaning` and `PlannedMove` as tests.

## Allowed Temporary Fallback

- `lib/session/response-gate-candidates.ts`
  - Still provides fallback text for hard structured task, game, commitment,
    verification, profile, and repair flows after the semantic plan is known.
- `lib/session/scene-state.ts`
  - Still owns deterministic state updates for task/game/profile modes.
- `lib/session/short-follow-up.ts`
  - Still realizes clarification and training-thread continuations when those
    are the active structured context.

## Delete Later

- Remaining open-chat raw text branches in `lib/chat/open-question.ts` should be
  migrated behind `TurnMeaning` question shapes and answer contracts as new
  meaning classes are promoted.
- Generic conversational rescue paths in `response-gate-candidates.ts` should keep
  shrinking as semantic content realization grows.

## Fenced Legacy Emitters

- Generic comparison text such as "Give me the two real options" remains only in
  `open-question.ts` for non-Raven, non-domain comparison questions. Raven
  preference comparisons now use the `binary_compare_or_choice` contract.
- Raven preference handling is fenced by requested facet: it rejects current
  status and definition facets, and it only answers possession/tool questions
  through the explicit tool-availability boundary in the preference model.
- "Keep going" and similar continuation lines remain allowed only inside
  explicit continuation, active game, task, or conversation-lead flows. Raven
  preference/domain contracts reject them before visible commit.
