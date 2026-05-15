import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

test("/api/chat visible response helper always applies SERVER_AUTHORITY_COMMIT_V2", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const helperStart = source.indexOf("function createStaticAssistantNdjsonResponse");
  const helperEnd = source.indexOf("function buildChatResponseStatePayload", helperStart);
  const helperSource = source.slice(helperStart, helperEnd);

  assert.match(source, /SERVER_AUTHORITY_SENTINEL/);
  assert.match(helperSource, /authorityTrace: authorizedPayload\.authorityTrace/);
  assert.match(helperSource, /\.\.\.authorizedPayload\.authorityTrace/);
  assert.match(helperSource, /authorizeStaticAssistantStatePayload\(text, extraHeaders, statePayload\)/);
  assert.match(helperSource, /createHandledAuthorityErrorNdjsonResponse/);
  assert.match(helperSource, /createAuthorityErrorPayload/);
  assert.match(helperSource, /buildServerAuthorityTrace/);
  assert.match(helperSource, /trace\.visible_commit_allowed === true/);
});

test("/api/chat planner validation errors return authority_error instead of assistant text", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const plannerStart = source.indexOf("if (planner.enabled)");
  const plannerEnd = source.indexOf("const rawAssistantText", plannerStart);
  const plannerSource = source.slice(plannerStart, plannerEnd);

  assert.match(plannerSource, /parseAndValidatePlannedStep/);
  assert.match(plannerSource, /errorCategory: "planner_validation_error"/);
  assert.match(plannerSource, /blockedReason: "planner_step_missing_required_fields"/);
  assert.match(plannerSource, /server_authority_sentinel/);
  assert.doesNotMatch(plannerSource, /createSafeFallbackStep/);
  assert.doesNotMatch(plannerSource, /response:\s*rawPlannerText/);
});

test("/api/chat logs loud route authority diagnostics", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");

  assert.match(source, /route_received_user_text/);
  assert.match(source, /planner_strategy/);
  assert.match(source, /planner_step_valid/);
  assert.match(source, /planner_error_category/);
  assert.match(source, /response_brief_created/);
  assert.match(source, /visible_authority_commit_attempted/);
  assert.match(source, /server_authority_sentinel_attached/);
  assert.match(source, /ndjson_assistant_payload_sent/);
  assert.match(source, /ndjson_error_payload_sent/);
});

test("NDJSON assistant payload cannot be sent without same-chunk authorityTrace", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const helperStart = source.indexOf("function createStaticAssistantNdjsonResponse");
  const helperEnd = source.indexOf("function hasRequiredVisibleAuthorityFields", helperStart);
  const helperSource = source.slice(helperStart, helperEnd);

  assert.match(helperSource, /authorityTrace: authorizedPayload\.authorityTrace/);
  assert.match(helperSource, /\.\.\.authorizedPayload\.authorityTrace/);
  assert.match(helperSource, /ndjson_assistant_payload_sent: Boolean\(text\.trim\(\)\)/);
});

test("/api/chat ordinary turns retry approved response-brief renderer before fallback commit", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const responseBriefStart = source.indexOf("const responseBrief = buildResponseBrief");
  const responseBriefEnd = source.indexOf("const activeInteractionUpdate", responseBriefStart);
  const renderSource = source.slice(responseBriefStart, responseBriefEnd);

  assert.match(renderSource, /buildResponseBriefPrompt\(responseBrief, responseBriefValidation\)/);
  assert.match(renderSource, /response_brief_llm_renderer_retry/);
  assert.match(renderSource, /finalOutputSource = "llm_brief_realizer"/);
  assert.match(renderSource, /assistantOutputQuality = "valid_model_reply"/);
  assert.match(renderSource, /approved_response_brief_fallback/);
});

test("/api/chat failed fulfillment returns authority_error instead of assistant payload", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const contractStart = source.indexOf("const finalRequestFulfilled");
  const contractEnd = source.indexOf("const activeInteractionUpdate", contractStart);
  const contractSource = source.slice(contractStart, contractEnd);

  assert.match(contractSource, /assistantOutputQuality !== "failed_fulfillment"/);
  assert.match(contractSource, /assistantOutputContextEligible/);
  assert.match(contractSource, /responseBriefValidation\.ok/);
  assert.match(contractSource, /const renderErrorCategory/);
  assert.match(contractSource, /"no_valid_visible_reply"/);
  assert.match(contractSource, /createHandledAuthorityErrorNdjsonResponse/);
  assert.doesNotMatch(contractSource, /status: 500/);
});

test("/api/chat planner validation errors are handled debug payloads, not server crashes", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const plannerStart = source.indexOf("if (planner.enabled)");
  const plannerEnd = source.indexOf("const validated = validatePlannerStepAgainstCatalog", plannerStart);
  const plannerSource = source.slice(plannerStart, plannerEnd);

  assert.match(plannerSource, /errorCategory: "planner_validation_error"/);
  assert.match(plannerSource, /blockedReason: "planner_step_missing_required_fields"/);
  assert.match(plannerSource, /visible_authority_commit_attempted: false/);
  assert.match(plannerSource, /ndjson_error_payload_sent: true/);
  assert.match(plannerSource, /createHandledAuthorityErrorNdjsonResponse/);
  assert.doesNotMatch(plannerSource, /status: 500/);
});

test("/api/chat passes fulfillment fields into visible authority selection", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");

  assert.match(source, /assistantOutputQuality,/);
  assert.match(source, /assistantOutputContextEligible,/);
  assert.match(source, /requestFulfilled: responseBriefValidation\.ok && assistantOutputContextEligible/);
  assert.match(source, /trace\.assistant_output_quality !== "failed_fulfillment"/);
  assert.match(source, /trace\.assistant_output_quality !== "generic_assistant_voice"/);
  assert.match(source, /trace\.assistant_output_context_eligible === true/);
  assert.match(source, /trace\.request_fulfilled === true/);
});

test("/api/chat relational renderer failure does not let response_brief_repair become the main writer", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const renderStart = source.indexOf("const shouldRetryApprovedRenderer");
  const renderEnd = source.indexOf("const finalRequestFulfilled", renderStart);
  const renderSource = source.slice(renderStart, renderEnd);

  assert.match(renderSource, /const shouldRetryApprovedRenderer = ordinaryOrRelationalRender/);
  assert.match(renderSource, /llmRendererRetryUsed = true/);
  assert.match(renderSource, /response_brief_repair_blocked_after_llm_retry/);
  assert.match(renderSource, /assistantOutputQuality = "failed_fulfillment"/);
  assert.match(renderSource, /response_brief_soft_accept_conversational_model_candidate/);
});

test("/api/chat expected route failures are handled authority_error NDJSON, not 500", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");

  assert.doesNotMatch(source, /status:\s*5\d\d/);
  assert.match(source, /function createHandledAuthorityErrorNdjsonResponse/);
  assert.match(source, /createAuthorityErrorPayload/);
  assert.match(source, /assistant_text_sent: false/);
  assert.match(source, /content-type": "application\/x-ndjson; charset=utf-8"/);
  assert.match(source, /errorCategory: "planner_validation_error"/);
  assert.match(source, /errorCategory: "renderer_validation_error"/);
  assert.match(source, /errorCategory: "model_unavailable"/);
  assert.match(source, /"no_valid_visible_reply"/);
});

test("/api/chat model and renderer calls have timeout boundaries", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");

  assert.match(source, /const PLANNER_TIMEOUT_MS = \d+/);
  assert.match(source, /const MODEL_TIMEOUT_MS = \d+/);
  assert.match(source, /const RENDERER_TIMEOUT_MS = \d+/);
  assert.match(source, /const ROUTE_TOTAL_TIMEOUT_MS = \d+/);
  assert.match(source, /fetchWithTimeout\(`/);
  assert.match(source, /planner\.enabled \? PLANNER_TIMEOUT_MS : MODEL_TIMEOUT_MS/);
  assert.match(source, /RENDERER_TIMEOUT_MS/);
  assert.match(source, /errorCategory: upstreamFetch\.timedOut \? "model_timeout" : "model_unavailable"/);
});

test("/api/chat session turns do not enable planner step validation for normal relational response path", () => {
  const clientSource = readFileSync(path.join(process.cwd(), "app/session/SessionClient.tsx"), "utf8");
  const payloadStart = clientSource.indexOf("body: JSON.stringify({", clientSource.indexOf("generateSessionRespondText"));
  const payloadEnd = clientSource.indexOf("}).catch", payloadStart);
  const payloadSource = clientSource.slice(payloadStart, payloadEnd);

  assert.match(payloadSource, /sessionMode: true/);
  assert.doesNotMatch(payloadSource, /planner:/);
});

test("server traces expose assistant output state eligibility separately from visible eligibility", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");

  assert.match(source, /const assistantOutputStateEligible/);
  assert.match(source, /assistantOutputQuality === "valid_model_reply"/);
  assert.match(source, /assistant_output_state_eligible: assistantOutputStateEligible/);
  assert.match(source, /assistantText: assistantOutputStateEligible \? finalAssistantText : ""/);
});
