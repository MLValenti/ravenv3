import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildServerAuthorityTrace,
  extractAuthorityTraceFromAssistantPayload,
  SERVER_AUTHORITY_SENTINEL,
  summarizeAssistantPayloadShape,
  validateServerAuthorizedRavenOutput,
} from "../lib/session/client-visible-authority.ts";

function validTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authority_trace_present: true,
    authority_trace_version: "visible-output-authority-v2",
    server_authority_sentinel: SERVER_AUTHORITY_SENTINEL,
    server_commit_path: "route_authorized_visible_commit",
    final_visible_owner: "approved_llm_renderer_from_response_brief",
    final_visible_source: "model",
    candidate_kind: "visible_assistant_prose",
    candidate_visible_safe: true,
    visible_commit_allowed: true,
    client_generated_reply_used: false,
    ...overrides,
  };
}

test("SessionClient rejects assistant line with missing authorityTrace", () => {
  const result = validateServerAuthorizedRavenOutput({
    text: "Visible text",
    authorityTrace: null,
    serverCommitPath: "route_authorized_visible_commit",
    sourceUserMessageId: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "authority_trace_missing");
});

test("SessionClient rejects assistant line with authority_trace_present=false", () => {
  const result = validateServerAuthorizedRavenOutput({
    text: "Visible text",
    authorityTrace: validTrace({ authority_trace_present: false }),
    serverCommitPath: "route_authorized_visible_commit",
    sourceUserMessageId: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "authority_trace_present_not_true");
});

test("SessionClient rejects assistant line with server_commit_path=missing", () => {
  const result = validateServerAuthorizedRavenOutput({
    text: "Visible text",
    authorityTrace: validTrace({ server_commit_path: "missing" }),
    serverCommitPath: "missing",
    sourceUserMessageId: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "server_commit_path_missing");
});

test("SessionClient rejects client-generated assistant prose even with other authority fields", () => {
  const result = validateServerAuthorizedRavenOutput({
    text: "Visible text",
    authorityTrace: validTrace({ client_generated_reply_used: true }),
    serverCommitPath: "route_authorized_visible_commit",
    sourceUserMessageId: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "client_generated_reply_used");
});

test("appendServerAuthorizedRavenOutput authority validator accepts valid server-authorized payload", () => {
  const result = validateServerAuthorizedRavenOutput({
    text: "Visible text",
    authorityTrace: validTrace(),
    serverCommitPath: "route_authorized_visible_commit",
    sourceUserMessageId: 1,
  });

  assert.equal(result.ok, true);
});

test("client extracts authority trace from the same NDJSON object as assistant text", () => {
  const authorityTrace = validTrace();
  const payload = {
    response: "Hi.",
    done: true,
    authorityTrace,
    semanticTrace: { authority_trace_present: false },
  };

  assert.equal(extractAuthorityTraceFromAssistantPayload(payload), authorityTrace);
  assert.deepEqual(summarizeAssistantPayloadShape(payload).has_authority_trace, true);
});

test("client extracts top-level authority fields from streamed assistant chunks", () => {
  const authorityTrace = validTrace();
  const payload = {
    response: "Hi.",
    done: true,
    ...authorityTrace,
  };

  const extracted = extractAuthorityTraceFromAssistantPayload(payload);
  assert.equal(extracted?.server_authority_sentinel, SERVER_AUTHORITY_SENTINEL);
  assert.equal(extracted?.authority_trace_present, true);
});

test("server authority builder creates same-payload visible authorization for simple hi", () => {
  const authorityTrace = buildServerAuthorityTrace({
    generationPath: "model",
    finalOutputSource: "llm_brief_realizer",
    semanticTrace: {
      authority_trace_present: true,
      authority_trace_version: "visible-output-authority-v2",
      server_commit_path: "route_authorized_visible_commit",
      candidate_kind: "visible_assistant_prose",
      candidate_visible_safe: true,
      visible_commit_allowed: true,
      client_generated_reply_used: false,
      assistant_output_quality: "valid_model_reply",
      assistant_output_context_eligible: true,
      request_fulfilled: true,
      response_brief_id: "brief-hi",
    },
  });

  assert.equal(authorityTrace.server_authority_sentinel, SERVER_AUTHORITY_SENTINEL);
  assert.equal(authorityTrace.authority_trace_present, true);
  assert.equal(authorityTrace.candidate_kind, "visible_assistant_prose");
  assert.equal(authorityTrace.candidate_visible_safe, true);
  assert.equal(authorityTrace.visible_commit_allowed, true);
  assert.equal(authorityTrace.client_generated_reply_used, false);
  assert.equal(authorityTrace.final_visible_owner, "approved_llm_renderer_from_response_brief");
  assert.equal(authorityTrace.model_reply_used, true);
});

test("server authority builder does not upgrade failed or nonvisible semantic trace", () => {
  const authorityTrace = buildServerAuthorityTrace({
    generationPath: "route_visible_commit_authority",
    finalOutputSource: "deterministic_brief_fallback",
    semanticTrace: {
      authority_trace_present: true,
      authority_trace_version: "visible-output-authority-v2",
      server_commit_path: "missing",
      candidate_kind: "nonvisible_fallback_plan",
      candidate_visible_safe: false,
      visible_commit_allowed: false,
      client_generated_reply_used: false,
      assistant_output_quality: "failed_fulfillment",
      assistant_output_context_eligible: false,
      request_fulfilled: false,
      response_brief_id: "brief-hi",
    },
  });

  assert.equal(authorityTrace.server_authority_sentinel, SERVER_AUTHORITY_SENTINEL);
  assert.equal(authorityTrace.candidate_kind, "nonvisible_fallback_plan");
  assert.equal(authorityTrace.candidate_visible_safe, false);
  assert.equal(authorityTrace.visible_commit_allowed, false);
  assert.equal(authorityTrace.assistant_output_quality, "failed_fulfillment");
  assert.equal(authorityTrace.assistant_output_context_eligible, false);
  assert.equal(authorityTrace.request_fulfilled, false);
});

test("server-approved fallback authority still carries SERVER_AUTHORITY_COMMIT_V2", () => {
  const authorityTrace = buildServerAuthorityTrace({
    generationPath: "route_visible_commit_authority",
    finalOutputSource: "deterministic_brief_fallback",
    semanticTrace: {
      authority_trace_present: true,
      authority_trace_version: "visible-output-authority-v2",
      server_commit_path: "route_authorized_visible_commit",
      final_visible_owner: "approved_response_brief_fallback",
      final_visible_source: "deterministic_brief_fallback",
      candidate_kind: "visible_assistant_prose",
      candidate_visible_safe: true,
      visible_commit_allowed: true,
      client_generated_reply_used: false,
      assistant_output_quality: "valid_fallback_reply",
      assistant_output_context_eligible: true,
      request_fulfilled: true,
      response_brief_id: "brief-planner-repair",
      replacement_chain: [
        {
          reason: "planner_error_response_brief_fallback",
          sourcePath: "routeVisibleCommitAuthority",
        },
      ],
    },
  });

  assert.equal(authorityTrace.server_authority_sentinel, SERVER_AUTHORITY_SENTINEL);
  assert.equal(authorityTrace.authority_trace_present, true);
  assert.equal(authorityTrace.final_visible_owner, "approved_response_brief_fallback");
  assert.equal(authorityTrace.candidate_kind, "visible_assistant_prose");
  assert.equal(authorityTrace.visible_commit_allowed, true);
});

test("previous failed live outputs cannot appear with authority_trace_present=false", () => {
  const failedFlow = [
    "hi",
    "what?",
    "i just want to become your sub",
    "huh?",
    "i would become your sub and be trained in the way to be a better submissive",
  ];

  for (const text of failedFlow) {
    const result = validateServerAuthorizedRavenOutput({
      text,
      authorityTrace: validTrace({ authority_trace_present: false }),
      serverCommitPath: "route_authorized_visible_commit",
      sourceUserMessageId: 1,
    });
    assert.equal(result.ok, false);
  }
});

test("SessionClient has one ravenLines assistant append path and no appendRavenOutput function", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /function\s+appendRavenOutput\b/);
  assert.doesNotMatch(source, /\bappendRavenOutput\s*\(/);
  assert.match(source, /function\s+appendServerAuthorizedRavenOutput\b/);

  const setRavenLinesMatches = [...source.matchAll(/\bsetRavenLines\s*\(/g)];
  assert.equal(setRavenLinesMatches.length, 1);
  const appendFunctionIndex = source.indexOf("function appendServerAuthorizedRavenOutput");
  assert.ok(appendFunctionIndex >= 0);
  assert.ok(setRavenLinesMatches[0].index > appendFunctionIndex);
});

test("blocked append diagnostics are recorded without Raven output append", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );

  assert.match(source, /blockedAssistantAppend: true/);
  assert.match(source, /ravenOutputText: "blocked by authority gate"/);
  assert.match(source, /blockedAppendReason: input\.reason/);
  assert.match(source, /visibleAssistantStringsShownForTurn: 0/);
});

test("client records planner authority errors without recovery render", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );

  assert.match(source, /errorCategory === "planner_validation_error"/);
  assert.match(source, /stage:\s*errorCategory === "planner_validation_error"\s*\?\s*"planner_validation_error"/);
  assert.match(source, /blockedReason|blocked_reason/);
  assert.match(source, /recoverSkippedAssistantRenderFired: false/);
});

test("client handles HTTP 200 authority_error NDJSON as blocked debug, not empty pending output", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );

  assert.match(source, /authorityError\?: Record<string, unknown> \| null/);
  assert.match(source, /parsed\.type === "authority_error"/);
  assert.match(source, /if \(responsePayload\.authorityError\)/);
  assert.match(source, /recordBlockedAssistantAppend\(/);
  assert.match(source, /return null/);
});

test("client skips recovery render for authority-blocked appends", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );

  assert.match(source, /!appendResult\.reason\.startsWith\("authority_blocked:"\)/);
});

test("client does not write state or prompt-priority context for state-ineligible assistant output", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );

  assert.match(source, /function isAssistantTraceStateEligible/);
  assert.match(source, /assistant_output_state_eligible === true/);
  assert.match(source, /speechText && assistantStateEligible/);
  assert.match(source, /turn\.state_update\.skipped/);
  assert.match(source, /turn\.state_projection\.skipped/);
});

test("client planner validation errors clear pending planner state without Raven recovery text", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );
  const plannerStart = source.indexOf("planned = await planNextStep");
  const plannerEnd = source.indexOf("if (planned.fallback)", plannerStart);
  const plannerSource = source.slice(plannerStart, plannerEnd);

  assert.match(plannerSource, /setPlannerBusy\(false\)/);
  assert.match(plannerSource, /if \(planned\.plannerError\)/);
  assert.match(plannerSource, /decision: "noop"/);
  assert.match(plannerSource, /reason: planned\.plannerError\.blockedReason/);
  assert.doesNotMatch(plannerSource, /appendServerAuthorizedRavenOutput/);
  assert.doesNotMatch(plannerSource, /recoverSkippedAssistantRender/);
});

test("dynamic user-turn render preserves server authority trace from prepared response", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );
  const assignmentStart = source.indexOf("selectedTrace = prepared");
  const assignmentEnd = source.indexOf(": null;", assignmentStart);
  const assignmentSource = source.slice(assignmentStart, assignmentEnd);

  assert.match(assignmentSource, /semanticTrace: prepared\.trace\.semanticTrace/);
  assert.match(assignmentSource, /authorityTrace: prepared\.trace\.authorityTrace/);
  assert.match(assignmentSource, /payloadShapeSummary: prepared\.trace\.payloadShapeSummary/);
});

test("typed user input still enters acceptUserResponse", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );
  const submitStart = source.indexOf("function submitUserInput");
  const submitEnd = source.indexOf("function simulateStateEvent", submitStart);
  const submitSource = source.slice(submitStart, submitEnd);

  assert.match(submitSource, /event\.preventDefault\(\)/);
  assert.match(submitSource, /void acceptUserResponse\(text\)/);
  assert.match(submitSource, /setUserDraft\(""\)/);
});

test("recovery render cannot append Raven text outside the authority function", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/session/SessionClient.tsx"),
    "utf8",
  );
  const start = source.indexOf("function recoverSkippedAssistantRender");
  const end = source.indexOf("function handleEngineEvent", start);
  const recoverySource = source.slice(start, end);

  assert.match(recoverySource, /appendServerAuthorizedRavenOutput/);
  assert.doesNotMatch(recoverySource, /setRavenLines\s*\(/);
  assert.doesNotMatch(recoverySource, /commitManagedVisibleAssistantTurn\s*\(/);
});

test("client does not recover authority-blocked appends", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/session/live-turn-integrity.ts"),
    "utf8",
  );

  assert.match(source, /appendReason\.startsWith\("authority_blocked:"\)/);
  assert.match(source, /appendReason\.startsWith\("planner_validation_error:"\)/);
});
