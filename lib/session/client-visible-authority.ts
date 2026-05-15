export const SERVER_AUTHORITY_SENTINEL = "SERVER_AUTHORITY_COMMIT_V2";
export const VISIBLE_OUTPUT_AUTHORITY_TRACE_VERSION = "visible-output-authority-v2";

export type ClientVisibleAuthorityValidationInput = {
  text: string;
  authorityTrace: Record<string, unknown> | null | undefined;
  serverCommitPath?: string | null;
  sourceUserMessageId?: number | null;
};

export type AssistantAuthorityPayload = Record<string, unknown>;

export type AssistantPayloadShapeSummary = {
  has_response: boolean;
  has_authority_trace: boolean;
  has_semantic_trace: boolean;
  has_top_level_authority_fields: boolean;
  authority_trace_keys: string[];
  semantic_trace_keys: string[];
  top_level_keys: string[];
};

export type ClientVisibleAuthorityValidationResult =
  | {
      ok: true;
      text: string;
      authorityTrace: Record<string, unknown>;
      serverCommitPath: string;
      sourceUserMessageId: number;
    }
  | {
      ok: false;
      reason: string;
    };

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim() !== "missing";
}

const AUTHORITY_FIELD_KEYS = [
  "server_authority_sentinel",
  "authority_trace_present",
  "authority_trace_version",
  "server_commit_path",
  "final_visible_owner",
  "final_visible_source",
  "candidate_kind",
  "candidate_visible_safe",
  "visible_commit_owner",
  "visible_commit_allowed",
  "client_generated_reply_used",
  "model_reply_used",
  "llm_renderer_used",
  "brief_realizer_used",
  "approved_response_brief_fallback_used",
  "response_brief_used",
  "response_brief_id",
  "strict_relational_authority",
  "assistant_output_quality",
  "assistant_output_context_eligible",
  "assistant_output_state_eligible",
  "request_fulfilled",
  "replacement_chain",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractTopLevelAuthorityFields(payload: Record<string, unknown>): Record<string, unknown> | null {
  const hasAuthorityField = AUTHORITY_FIELD_KEYS.some((key) => key in payload);
  if (!hasAuthorityField) {
    return null;
  }
  const authority: Record<string, unknown> = {};
  for (const key of AUTHORITY_FIELD_KEYS) {
    if (key in payload) {
      authority[key] = payload[key];
    }
  }
  return authority;
}

export function extractAuthorityTraceFromAssistantPayload(
  payload: unknown,
): Record<string, unknown> | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const authorityTrace = asRecord(record.authorityTrace);
  if (authorityTrace) {
    return authorityTrace;
  }
  const topLevel = extractTopLevelAuthorityFields(record);
  if (topLevel) {
    return topLevel;
  }
  return asRecord(record.semanticTrace);
}

export function summarizeAssistantPayloadShape(payload: unknown): AssistantPayloadShapeSummary {
  const record = asRecord(payload);
  const authorityTrace = asRecord(record?.authorityTrace);
  const semanticTrace = asRecord(record?.semanticTrace);
  const topLevelKeys = record ? Object.keys(record).sort() : [];
  return {
    has_response: typeof record?.response === "string",
    has_authority_trace: Boolean(authorityTrace),
    has_semantic_trace: Boolean(semanticTrace),
    has_top_level_authority_fields:
      Boolean(record && AUTHORITY_FIELD_KEYS.some((key) => key in record)),
    authority_trace_keys: authorityTrace ? Object.keys(authorityTrace).sort() : [],
    semantic_trace_keys: semanticTrace ? Object.keys(semanticTrace).sort() : [],
    top_level_keys: topLevelKeys,
  };
}

function ownerFromSource(source: unknown): string {
  const normalized = typeof source === "string" ? source : "";
  if (/deterministic_brief_fallback/i.test(normalized)) {
    return "approved_response_brief_fallback";
  }
  if (/model|llm_brief_realizer|raw_model/i.test(normalized)) {
    return "approved_llm_renderer_from_response_brief";
  }
  if (/memory-command|memory_command/i.test(normalized)) {
    return "memory_command_renderer";
  }
  return "hard_lock_structured_renderer";
}

export function buildServerAuthorityTrace(input: {
  semanticTrace?: unknown;
  generationPath?: string | null;
  finalOutputSource?: string | null;
  serverCommitPath?: string | null;
}): Record<string, unknown> {
  const record = asRecord(input.semanticTrace) ?? {};
  const generationPath = input.generationPath || "route_authorized_visible_commit";
  const finalSource =
    input.finalOutputSource ||
    (typeof record.final_visible_source === "string" ? record.final_visible_source : null) ||
    generationPath;
  const owner =
    typeof record.final_visible_owner === "string" && record.final_visible_owner !== "blocked"
      ? record.final_visible_owner
      : ownerFromSource(finalSource);
  return {
    ...record,
    server_authority_sentinel: SERVER_AUTHORITY_SENTINEL,
    authority_trace_present: record.authority_trace_present === false ? false : true,
    authority_trace_version: VISIBLE_OUTPUT_AUTHORITY_TRACE_VERSION,
    server_commit_path:
      input.serverCommitPath ||
      (hasValue(record.server_commit_path) ? record.server_commit_path : null) ||
      "route_authorized_visible_commit",
    final_visible_owner: owner,
    final_visible_source: finalSource,
    candidate_kind:
      typeof record.candidate_kind === "string"
        ? record.candidate_kind
        : "visible_assistant_prose",
    candidate_visible_safe: record.candidate_visible_safe === false ? false : true,
    visible_commit_owner:
      typeof record.visible_commit_owner === "string" && record.visible_commit_owner !== "blocked"
        ? record.visible_commit_owner
        : owner,
    visible_commit_allowed: record.visible_commit_allowed === false ? false : true,
    client_generated_reply_used: false,
    model_reply_used:
      record.model_reply_used ?? /model|raw_model|llm_brief_realizer/i.test(finalSource),
    llm_renderer_used:
      record.llm_renderer_used ?? (owner === "approved_llm_renderer_from_response_brief"),
    brief_realizer_used:
      record.brief_realizer_used ??
      (owner === "approved_llm_renderer_from_response_brief" ||
        owner === "approved_response_brief_fallback"),
    approved_response_brief_fallback_used:
      record.approved_response_brief_fallback_used ??
      (owner === "approved_response_brief_fallback"),
    response_brief_used:
      record.response_brief_used ??
      (Boolean(record.response_brief_id) ||
        owner === "approved_llm_renderer_from_response_brief" ||
        owner === "approved_response_brief_fallback"),
    response_brief_id: record.response_brief_id ?? null,
    strict_relational_authority: record.strict_relational_authority ?? false,
    assistant_output_quality: record.assistant_output_quality ?? "unknown",
    assistant_output_context_eligible:
      record.assistant_output_context_eligible === false ? false : true,
    request_fulfilled: record.request_fulfilled === false ? false : true,
    replacement_chain: Array.isArray(record.replacement_chain) ? record.replacement_chain : [],
  };
}

export function createAuthorityErrorPayload(input: {
  blockedReason: string;
  errorCategory?: string | null;
  serverCommitPath?: string | null;
  rawResponseShape?: unknown;
  plannerError?: Record<string, unknown> | null;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    type: "authority_error",
    ...(input.errorCategory ? { error_category: input.errorCategory } : {}),
    authority_trace_present: false,
    server_authority_sentinel: "missing",
    blocked_reason: input.blockedReason,
    server_commit_path: input.serverCommitPath ?? "missing",
    raw_response_shape: input.rawResponseShape ?? null,
    ...(input.plannerError ? { planner_error: input.plannerError } : {}),
    ...(input.extra ?? {}),
  };
}

export function validateServerAuthorizedRavenOutput(
  input: ClientVisibleAuthorityValidationInput,
): ClientVisibleAuthorityValidationResult {
  const text = input.text.trim();
  if (!text) {
    return { ok: false, reason: "empty_text" };
  }
  if (!input.authorityTrace || typeof input.authorityTrace !== "object") {
    return { ok: false, reason: "authority_trace_missing" };
  }
  const trace = input.authorityTrace;
  if (trace.server_authority_sentinel !== SERVER_AUTHORITY_SENTINEL) {
    return { ok: false, reason: "server_authority_sentinel_missing" };
  }
  if (trace.authority_trace_present !== true) {
    return { ok: false, reason: "authority_trace_present_not_true" };
  }
  if (trace.authority_trace_version !== VISIBLE_OUTPUT_AUTHORITY_TRACE_VERSION) {
    return { ok: false, reason: "authority_trace_version_mismatch" };
  }
  const traceServerCommitPath = trace.server_commit_path;
  if (!hasValue(input.serverCommitPath) || !hasValue(traceServerCommitPath)) {
    return { ok: false, reason: "server_commit_path_missing" };
  }
  if (!hasValue(trace.final_visible_owner)) {
    return { ok: false, reason: "final_visible_owner_missing" };
  }
  if (!hasValue(trace.candidate_kind)) {
    return { ok: false, reason: "candidate_kind_missing" };
  }
  if (trace.candidate_kind !== "visible_assistant_prose") {
    return { ok: false, reason: "candidate_kind_not_visible_assistant_prose" };
  }
  if (trace.visible_commit_allowed !== true) {
    return { ok: false, reason: "visible_commit_allowed_not_true" };
  }
  if (trace.client_generated_reply_used === true) {
    return { ok: false, reason: "client_generated_reply_used" };
  }
  if (!Number.isFinite(input.sourceUserMessageId) || Number(input.sourceUserMessageId) <= 0) {
    return { ok: false, reason: "source_user_message_id_missing" };
  }
  return {
    ok: true,
    text,
    authorityTrace: trace,
    serverCommitPath: traceServerCommitPath.trim(),
    sourceUserMessageId: Number(input.sourceUserMessageId),
  };
}
