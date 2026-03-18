import { isSimpleGreeting } from "../dialogue/user-signals.ts";
import {
  buildClarifyNudge,
  buildHowAreYouOpenReply,
  buildOpenChatGreeting,
  buildOpenChatNudge,
} from "./mode-style.ts";
import {
  buildShortClarificationReply,
  isShortClarificationTurn,
} from "./short-follow-up.ts";

function normalizeWeakInput(text: string): string {
  return text.trim().toLowerCase().replace(/[!?.,]/g, "");
}

export function isGreetingOnlyUserMessage(text: string): boolean {
  return isSimpleGreeting(text);
}

export function isHowAreYouUserMessage(text: string): boolean {
  return /\bhow are you\b/i.test(text);
}

export function isThanksOnlyUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return ["thanks", "thank you", "ty"].includes(normalized);
}

export function isOkayOnlyUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return [
    "ok",
    "okay",
    "k",
    "yes",
    "yeah",
    "yep",
    "sure",
    "fine",
    "alright",
    "sounds good",
    "that works",
    "got it",
  ].includes(normalized);
}

export function isGoodNightUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return ["good night", "goodnight", "night", "night night"].includes(normalized);
}

export function isIdleWhatNextUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return ["what next", "what now", "now what", "whats next", "what's next"].includes(normalized);
}

export function isWhyOnlyUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return normalized === "why";
}

export function isClarifyOnlyUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return [
    "what do you mean",
    "explain",
    "clarify",
    "say that again",
    "repeat that",
  ].includes(normalized);
}

export function isConfusionOnlyUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return [
    "im confused",
    "i'm confused",
    "confused",
    "that makes no sense",
    "i dont understand",
    "i don't understand",
  ].includes(normalized);
}

export function isRefusalOnlyUserMessage(text: string): boolean {
  const normalized = normalizeWeakInput(text);
  if (!normalized) {
    return false;
  }
  return ["no", "nope", "not doing that"].includes(normalized);
}

function buildDeterministicDominantGreetingReply(lastUserMessage: string): string {
  if (isHowAreYouUserMessage(lastUserMessage)) {
    return buildHowAreYouOpenReply();
  }
  return buildOpenChatGreeting();
}

export function buildDeterministicDominantWeakInputReply(lastUserMessage: string): string | null {
  if (isGreetingOnlyUserMessage(lastUserMessage) || isHowAreYouUserMessage(lastUserMessage)) {
    return buildDeterministicDominantGreetingReply(lastUserMessage);
  }
  if (isThanksOnlyUserMessage(lastUserMessage)) {
    return "Good. Now give me the next real thing you want.";
  }
  if (isGoodNightUserMessage(lastUserMessage)) {
    return "You may go for now, pet. Come back focused and ready.";
  }
  if (isIdleWhatNextUserMessage(lastUserMessage)) {
    return "Then choose the next thread cleanly. What do you want?";
  }
  if (isWhyOnlyUserMessage(lastUserMessage)) {
    return "Because the reason matters. Name the part you want opened, and I will sharpen it.";
  }
  if (isShortClarificationTurn(lastUserMessage)) {
    return buildShortClarificationReply({
      userText: lastUserMessage,
      interactionMode: "question_answering",
    });
  }
  if (isClarifyOnlyUserMessage(lastUserMessage)) {
    return buildClarifyNudge();
  }
  if (isConfusionOnlyUserMessage(lastUserMessage)) {
    return "Then show me the part that is muddy, and I will sharpen it.";
  }
  if (isRefusalOnlyUserMessage(lastUserMessage)) {
    return buildOpenChatNudge();
  }
  return null;
}
