import { isSimpleGreeting } from "../dialogue/user-signals.ts";
import type { ConversationMode } from "./conversation-state.ts";

type SceneScope = "task_scoped" | "game_scoped" | "open_conversation";

export type FreshGreetingGuardInput = {
  text: string;
  lastUserMessage: string;
  promptRouteMode: string;
  currentMode: ConversationMode;
  pendingModification: string;
  lastUserIntent: string;
  sceneScope?: SceneScope | null;
  sceneTopicLocked?: boolean;
  taskHardLockActive?: boolean;
};

export type FreshGreetingGuardResult = {
  text: string;
  changed: boolean;
  reason: string | null;
};

function splitFirstSentence(text: string): string {
  return (text.trim().match(/[^.!?]+[.!?]?/)?.[0] ?? text.trim()).trim();
}

function countSentences(text: string): number {
  return (text.trim().match(/[^.!?]+[.!?]?/g) ?? []).filter((sentence) => sentence.trim().length > 0)
    .length;
}

function countCommandMarkers(text: string): number {
  return (
    text.match(
      /\b(listen|follow|obey|stay|keep|pay|hold|come|speak|kneel|stop|focus|watch)\b/gi,
    ) ?? []
  ).length;
}

function detectUnacceptableGreetingReason(text: string): string | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return "empty_greeting";
  }
  if (normalized === "enough hovering, pet. tell me what you actually want.") {
    return "weak_input_opener";
  }

  const firstLine = splitFirstSentence(text);
  if (
    /\b(you(?:'re| are) mine|mine now|belong to me|good pet|pet,\s*you will|you will\b)/i.test(
      firstLine,
    )
  ) {
    return "ownership_or_control_claim";
  }
  if (countCommandMarkers(firstLine) >= 2) {
    return "stacked_commands";
  }
  if (
    /\b(enough hovering|listen carefully|stay sharp|keep focus|pay attention|better focus|stop stalling)\b/i.test(
      firstLine,
    )
  ) {
    return "immediate_correction";
  }

  return null;
}

function buildCalmGreetingOpener(lastUserMessage: string): string {
  const normalized = lastUserMessage.trim().toLowerCase();
  if (normalized === "hi") {
    return "There you are. You have my attention.";
  }
  if (normalized === "hello") {
    return "Hello. You have my attention.";
  }
  if (normalized === "hey") {
    return "Hey. Speak.";
  }
  if (normalized === "good evening") {
    return "Good evening. You have my attention.";
  }
  return "You have my attention.";
}

function isEligibleFreshGreeting(input: FreshGreetingGuardInput): boolean {
  return (
    input.promptRouteMode === "fresh_greeting" &&
    input.currentMode === "normal_chat" &&
    input.pendingModification === "none" &&
    input.lastUserIntent !== "user_refusal_or_confusion" &&
    isSimpleGreeting(input.lastUserMessage) &&
    (input.sceneScope === undefined ||
      input.sceneScope === null ||
      input.sceneScope === "open_conversation") &&
    input.sceneTopicLocked !== true &&
    input.taskHardLockActive !== true
  );
}

export function applyFreshGreetingGuard(
  input: FreshGreetingGuardInput,
): FreshGreetingGuardResult {
  if (!isEligibleFreshGreeting(input)) {
    return {
      text: input.text,
      changed: false,
      reason: null,
    };
  }

  const reason = detectUnacceptableGreetingReason(input.text);
  if (!reason) {
    const firstSentence = splitFirstSentence(input.text);
    if (countSentences(input.text) > 1) {
      return {
        // Keep plain fresh greetings to one calm opener instead of letting later dominant filler stack onto them.
        text: firstSentence,
        changed: true,
        reason: "trimmed_to_first_sentence",
      };
    }
    return {
      text: input.text,
      changed: false,
      reason: null,
    };
  }

  return {
    // Keep low-stakes openers controlled without letting them harden into ownership, stacked commands, or correction.
    text: buildCalmGreetingOpener(input.lastUserMessage),
    changed: true,
    reason,
  };
}
