const THREAD_LABEL_MAP: Record<string, string> = {
  open_chat: "this conversation",
  relational_chat: "this exchange",
  normal_chat: "this conversation",
  question_answering: "your question",
  profile_building: "what I am learning about you",
  task_planning: "the task",
  task_execution: "the task already in motion",
  locked_task_execution: "the task already in motion",
  game: "the game",
  game_selection: "the game",
  general_request: "what you asked for",
};

const INTERNAL_LABEL_PATTERN =
  /\b(current[_ ]mode|active[_ ]thread|pending[_ ]modification|pending[_ ]user[_ ]request|output[_ ]shape|request[_ ]stage|selection[_ ]mode|session[_ ]intent|response[_ ]strategy|turn[_ ]plan|planner|runtime|orchestration)\b/i;

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

// Visible fallback text must never surface raw mode/thread/planner labels.
export function toUserFacingThreadLabel(
  value: string | null | undefined,
  fallback = "this conversation",
): string {
  const text = value?.trim();
  if (!text || /^none$/i.test(text)) {
    return fallback;
  }
  if (INTERNAL_LABEL_PATTERN.test(text)) {
    return fallback;
  }
  const mapped = THREAD_LABEL_MAP[normalizeLabel(text)];
  if (mapped) {
    return mapped;
  }
  if (/^[a-z0-9]+(?:[_ ][a-z0-9]+)+$/i.test(text) && text.includes("_")) {
    return fallback;
  }
  return text;
}

export function toUserFacingDetail(
  value: string | null | undefined,
  fallback = "the next clear move",
): string {
  const text = value?.trim();
  if (!text || /^none$/i.test(text)) {
    return fallback;
  }
  if (INTERNAL_LABEL_PATTERN.test(text)) {
    return fallback;
  }
  const mapped = THREAD_LABEL_MAP[normalizeLabel(text)];
  if (mapped) {
    return mapped;
  }
  if (/^[a-z0-9]+(?:[_ ][a-z0-9]+)+$/i.test(text) && text.includes("_")) {
    return fallback;
  }
  return text;
}
