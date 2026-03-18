# Session Quality Milestones

This roadmap covers the session-only conversation path in Raven. The focus is live `/session` behavior, not the retired standalone chat UI.

## SQ1. Deterministic Session Rail Stabilization

Status: completed

Goal:

- Keep game, wager, task, and consequence turns on the correct rail.
- Prevent generic fallback text from replacing valid deterministic session answers.
- Stop premature consequence enforcement and stale task repetition.

Delivered:

- Deterministic question replies in `/api/chat` now short-circuit before generic response gating.
- Game loss flow now ends the round, then waits for `ready` before consequence enforcement.
- Reward-window logic blocks `another round` until a pending Raven-win consequence is resolved.
- Completed tasks can hand off into a fresh next task instead of drifting into a generic fallback.
- Repeat-aware deterministic question variants reduce exact repeated lines on `first prompt` and `next task` turns.

Verification:

- `npm test`
- `npm run eval:session:local`

## SQ2. Deterministic Game Turn Polish

Status: completed

Goal:

- Make deterministic game replies feel less mechanical while staying reliable.

Scope:

- Add wording variation for tie, win, and loss resolution lines.
- Distinguish `turn result` from `round result` more clearly in RPS.
- Add explicit best-of logic or keep the game strictly sudden-death, but not a mixed presentation.
- Improve move acknowledgment for user inputs like `I choose rock` and `my move is paper`.

Exit criteria:

- No exact-repeat hard failures in the game eval path.
- Game transcript reads as one coherent round, not a chain of rail prompts.

## SQ3. Task Rail Natural Progression

Status: completed

Goal:

- Make task follow-up turns feel deliberate and less templated.

Scope:

- Add checkpoint wording variation for `assigned`, `secured`, `halfway_checked`, and `completed`.
- Distinguish `progress question`, `duration question`, and `new task request` more precisely.
- Add deterministic answers for questions like `how long until halfway`, `what counts as done`, and `set me another one`.

Exit criteria:

- Task flow no longer repeats the same checkpoint line on adjacent turns.
- Completed tasks open a new task cleanly when the user clearly asks for one.

Delivered:

- Task follow-up lines now vary across deterministic task variants instead of repeating one checkpoint string.
- Task timing replies now use stage-aware duration wording such as `1 hour` and `2 hours` instead of blunt minute counts.
- Deterministic task answers now handle `what counts as done`, `how long until halfway`, and `set me another one` directly.
- Active task question routing now stays on the task rail for timing and completion-definition questions instead of falling back to a generic clarification line.

## SQ4. Question-First Direct Answer Quality

Status: in_progress

Goal:

- Ensure Raven answers the user's direct question first, in character, without drifting into fallback rails.

Scope:

- Expand deterministic question coverage for game rules, prompt timing, wager clarification, task timing, and consequence clarification.
- Add repeat-safe variants for frequent question patterns.
- Tighten the route so scene-aware answers win over generic prompt shaping.

Progress:

- Task-stage question coverage now answers timing and completion-definition questions directly inside the deterministic scaffold.
- Completed-task prompts now prefer the next-task branch over generic duration fallback when the user explicitly asks for another task.

Exit criteria:

- `question_first_response` eval path has no repeat failures.
- Direct questions get direct answers without leaking internal prompt language.

## SQ5. Session Memory and Topic Carryover

Status: next

Goal:

- Make Raven hold one topic long enough to feel coherent across multiple turns.

Scope:

- Strengthen working-memory summaries for active game, active task, active wager, and active consequence.
- Persist last unresolved session thread more explicitly.
- Improve commitment carryover so Raven follows through on `I will choose`, `I will set the consequence`, and `I will give the next task`.

Exit criteria:

- Topic switches only happen when resolved or explicitly interrupted.
- Multi-turn game and wager conversations stay coherent without user restating context.

## SQ6. Authored Session Voice Packs

Status: next

Goal:

- Make deterministic session replies sound more in-character and less like system scaffolding.

Scope:

- Expand authored phrase packs for greetings, rules, wagers, consequence setup, task assignment, and checkpoint replies.
- Use structured style packs to vary deterministic lines without losing control.
- Keep all deterministic wording aligned to Raven's dominant persona.

Exit criteria:

- Deterministic replies feel authored, not placeholder-like.
- Fallback lines remain in character under repetition and stress cases.
