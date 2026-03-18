import {
  buildFallbackCreateTaskRequest,
  isTaskRequestMessage,
  looksLikeFinalTaskAssignmentText,
} from "../tasks/task-request-fallback.ts";
import {
  parseCreateTaskRequestFromText,
  type CreateTaskRequest,
} from "../tasks/system.ts";

export type ChatMessageLike = {
  role: "user" | "assistant" | "system";
  content: string;
};

export function getLastNonSystemMessage(
  messages: ChatMessageLike[],
): ChatMessageLike | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "system") {
      return message;
    }
  }
  return null;
}

export function shouldNoopForNoNewUserMessage(input: {
  messages: ChatMessageLike[];
  sessionMode: boolean;
  plannerEnabled: boolean;
}): boolean {
  if (!input.sessionMode || input.plannerEnabled) {
    return false;
  }
  const last = getLastNonSystemMessage(input.messages);
  return last?.role === "assistant";
}

export function resolveTaskRequestFromAssistantOutput(input: {
  shapedText: string;
  lastUserText: string;
  allowedCheckTypes: string[];
  sessionMode: boolean;
}): CreateTaskRequest | null {
  if (!input.sessionMode) {
    return null;
  }
  const parsed = parseCreateTaskRequestFromText(input.shapedText);
  if (parsed) {
    return parsed;
  }
  if (!isTaskRequestMessage(input.lastUserText)) {
    return null;
  }
  if (!looksLikeFinalTaskAssignmentText(input.shapedText)) {
    return null;
  }
  return buildFallbackCreateTaskRequest({
    userText: input.lastUserText,
    assistantText: input.shapedText,
    allowedCheckTypes: input.allowedCheckTypes,
  });
}
