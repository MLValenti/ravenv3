# Live Output Authority Map

This map documents current modules that can create, replace, sanitize, select, or commit visible assistant text. The target authority rule is:

`ordinary conversation or relational turn -> ResponseBrief -> approved LLM renderer -> output validator -> one visible commit`

For ordinary and relational turns, legacy modules may create trace candidates only. They must not own final visible prose.

| File | Function | Can create visible prose | Can replace visible prose | Can commit visible prose | Current owner role | Should remain allowed for ordinary or relational turns | New allowed role | Notes |
|---|---|---:|---:|---:|---|---:|---|---|
| `app/session/SessionClient.tsx` | `fallbackRespondText` | Yes | No | Indirect | Client fallback writer | No | Client recovery candidate only | Must never commit local fallback when a server-approved response exists. |
| `app/session/SessionClient.tsx` | `appendRavenOutput` | No | No | Yes | Client visible commit point | Yes | Commit server-approved visible output only | Client commit ownership is allowed only for already approved server text. |
| `app/session/SessionClient.tsx` | recovery/error branches | Yes | Yes | Yes | Client recovery writer | No | Error UI only when no server output exists | Must not synthesize Raven prose over a valid server response. |
| `app/api/chat/route.ts` | model response path | Yes | Yes | No | Server route content selector | Yes | Build/repair from `ResponseBrief` and annotate trace | Route must not select legacy prose for ordinary or relational turns. |
| `app/api/chat/route.ts` | `buildTurnPlanFallback` callsites | Yes | Yes | No | Server fallback writer | No | Trace candidate only | Fenced by `visible-output-authority`. |
| `app/api/chat/route.ts` | memory command branches | Yes | Yes | No | Memory command renderer | No for ordinary/relational | Explicit command response only | Separate command result from ordinary chat ownership. |
| `lib/session/live-turn-controller.ts` | `handleTurn` deterministic replay/bypass path | Yes | Yes | No | Live controller bypass | No, unless hard lock | Structured hard-lock renderer only | Bypass now traces deterministic usage and is blocked outside hard structured modes. |
| `lib/session/response-gate.ts` | `applyResponseGate` | Yes | Yes | No | Gate/fallback/repair writer | Yes, as validator | Validate, reject, annotate; re-realize through brief | The gate can trigger brief re-realization, but cannot choose a new semantic move. |
| `lib/session/response-gate.ts` | fallback helpers inside gate | Yes | Yes | No | Gate fallback writer | No | Approved brief fallback only after bounded repair | Final owner must be `approved_llm_renderer_from_response_brief` or `approved_response_brief_fallback`. |
| `lib/session/response-gate-candidates.ts` | `buildOpenConversationFallback` | Yes | No | No | Candidate fallback writer | No | Trace candidate only | Candidate can explain what would have happened, not win. |
| `lib/session/response-gate-candidates.ts` | `buildFallback` | Yes | No | No | Candidate fallback writer | No | Trace candidate only | Fenced for ordinary/relational turns. |
| `lib/session/response-gate-candidates.ts` | `buildTurnPlanFallbackCandidate` | Yes | No | No | Turn-plan fallback candidate | No | Trace candidate only | Required trace marks `turn_plan_fallback_created` / `_used`. |
| `lib/session/scene-scaffolds.ts` | scaffold builders | Yes | No | No | Scene/game/task scaffold writers | No for ordinary/relational | Trace candidate only unless explicit game/task hard lock | Game text is blocked unless domain/interaction is game. |
| `lib/chat/open-question.ts` | open/direct question answer builders | Yes | No | No | Open-question fallback writer | No | Semantic input/candidate only | Direct answers should be represented in a brief, then rendered by approved renderer. |
| `lib/chat/repair-turn.ts` | repair response builders | Yes | No | No | Repair fallback writer | No | Trace candidate only | Raw repair instructions must never be visible. |
| `lib/session/short-follow-up.ts` | short follow-up reply builders | Yes | No | No | Continuation fallback writer | No | Continuation interpretation only | Follow-ups attach to previous brief/active state; prose comes from approved renderer. |
| `lib/session/weak-input-replies.ts` | weak input reply builders | Yes | No | No | Weak-input fallback writer | No | Blocked fallback candidate | “Keep going” and similar lines are invalid for semantic-owned turns. |
| `lib/session/deterministic-scene-routing.ts` | `explainBypassModelForSceneTurn` | No | Selects bypass | No | Bypass arbiter | No, unless hard lock | Hard-lock eligibility only | Ordinary conversation no longer bypasses through `semantic_open_conversation_planner`. |
| `lib/session/scene-state.ts` | assistant/user turn note helpers | No | No | No | State persistence | Yes | State only | Must not be used as visible prose source. |
| `lib/session/response-brief.ts` | `realizeResponseFromBrief` | Yes | Yes | No | Approved fallback/renderer boundary | Yes | Approved renderer/fallback source | LLM brief renderer is preferred; deterministic brief fallback is allowed only after unavailable/failed LLM path. |
| `lib/session/response-brief.ts` | `validateReplyAgainstBrief` | No | Rejects | No | Contract validator | Yes | Validator | Blocks unsafe unlimited-consent claims and contract misses. |
| `lib/session/active-interaction.ts` | active state transitions | No | No | No | State transition | Yes | State only | Provides continuity inputs to the brief and router. |
| `lib/session/live-turn-integrity.ts` | `shouldAllowVisibleAssistantCommit` | No | Rejects stale/duplicate commits | Yes gate | Commit integrity guard | Yes | Commit race guard | Used to prevent stale/local commit races. |
| `lib/session/session-state-contract.ts` | state contract helpers | No | No | No | Session state contract | Yes | State only | Durable state must carry active interaction, not prose ownership. |
| `lib/chat/conversation-quality.ts` | quality/repetition helpers | No | Rejects/flags | No | Quality validator | Yes | Validator signal only | May reject repeated or low-quality outputs, not author a replacement. |
| `lib/chat/turn-plan.ts` | turn-plan fallback/prose helpers | Yes | No | No | Turn-plan writer | No | Structured action-plan input only | Fallback prose is fenced by authority. |
| `lib/chat/response-strategy.ts` | response strategy fallback builders | Yes | No | No | Strategy writer | No | Structured strategy input only | Strategy cannot own final visible text for ordinary/relational turns. |
| `lib/session/visible-output-authority.ts` | `selectVisibleOutputOwner` | No | Selects owner | No | Central authority arbiter | Yes | Owner selection | Ordinary/relational final owner must be approved brief renderer/fallback. |
| `lib/session/visible-output-authority.ts` | `commitVisibleOutput` | No | Rejects | Yes gate | Authority commit gate | Yes | Final authority gate | Blocks blocked owners and unsafe unlimited-consent text before visible commit. |

## Authority Rule

For ordinary conversation and relational turns:

1. Legacy emitters can be recorded as `all_visible_candidates`.
2. Legacy emitters are marked in `rejected_visible_candidates` when authority applies.
3. If a legacy emitter would have won, `replacement_chain` records the reroute.
4. Final prose must come from `approved_llm_renderer_from_response_brief`, or from `approved_response_brief_fallback` only when the LLM path is unavailable or fails bounded validation.
5. `response-gate` can reject and request re-realization from the same `ResponseBrief`, but it cannot pick a new domain, move, or legacy prose source.
6. Client code can commit only server-approved visible text. Local Raven fallback prose is not an ordinary/relational output owner.

## Visible Candidate Type Boundary

Every candidate that can approach `raven_output` is now typed before commit:

- `visible_assistant_prose`
- `nonvisible_renderer_instruction`
- `nonvisible_state_summary`
- `nonvisible_validator_reason`
- `nonvisible_repair_instruction`
- `nonvisible_fallback_plan`
- `nonvisible_debug_summary`
- `nonvisible_prompt_fragment`

`commitVisibleOutput` only accepts `visible_assistant_prose` with `visible_safe: true`, an approved owner, and no nonvisible `internal_source_type`. Nonvisible candidates are rejected structurally before string lint runs. `ResponseBrief` fields are split into visible intent/constraints plus nonvisible renderer, state, repair, validation, and debug fields; those fields may guide rendering but are not renderable output.

## Generalized Continuity Rules

1. Internal fields are nonvisible data. System instructions, renderer instructions, validator reasons, debug labels, mode names, route names, state summaries, candidate lists, memory slot lists, and response brief metadata are rejected before visible commit.
2. `conversation_mode` is advisory. Active relational state, training state, role negotiation state, or an immediately prior substantive assistant ask can override shallow `normal_chat` or `question_answering` labels.
3. Repair turns are anchored to the immediately previous assistant answer or persisted ask. The repair path may classify broad categories such as clarification, confusion, complaint, or correction; it may not start a fresh open Q&A rail.
4. Role negotiation is stateful. Once role options are offered, later acknowledgements, rejections, modifications, and clarifications update role state instead of replaying the same menu.
5. `ResponseBrief` is a plan contract, not final prose. Fallback rendering is typed as a visible-safe fallback plan and remains exceptional.
6. Repeated `approved_response_brief_fallback` use in ordinary relational conversation is a defect signal, not a normal routing strategy.

## Safety Guard

Visible output is rejected if it says or implies that no safeword means unlimited consent. Absence of a safeword never removes limits, consent, or stop conditions.
