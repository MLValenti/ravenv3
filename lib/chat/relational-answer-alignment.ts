import {
  isAssistantSelfQuestion,
  isAssistantServiceQuestion,
  isMutualGettingToKnowRequest,
} from "../session/interaction-mode.ts";
import { questionSatisfiedMeaningfully } from "./question-satisfaction.ts";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const INTERNAL_RELATIONAL_RESIDUE_PATTERNS = [
  /\btone_variant\b/i,
  /\bmemory context\b/i,
  /\bprofile facts\b/i,
  /\bselected playbooks\b/i,
  /\bact examples\b/i,
  /\bstate guidance\b/i,
  /\bprompt route\b/i,
  /\bconversation state\b/i,
];

export function containsRelationalPromptResidue(text: string): boolean {
  return INTERNAL_RELATIONAL_RESIDUE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isCoherentMutualGetToKnowAnswer(
  userText: string,
  responseText: string,
): boolean {
  if (!isMutualGettingToKnowRequest(userText) || containsRelationalPromptResidue(responseText)) {
    return false;
  }
  const normalized = normalize(responseText);
  return (
    /\b(i want to know|i want to hear|i pay attention|what holds my attention|what matters to me)\b/.test(
      normalized,
    ) ||
    /\b(put a real question on me first|play it both ways|ask me something real|what do you want to know first)\b/.test(
      normalized,
    ) ||
    /\b(tell me where .* started|tell me what people usually (?:miss|get wrong) about you|tell me one thing people usually miss)\b/.test(
      normalized,
    )
  );
}

export function isCoherentAssistantServiceAnswer(
  userText: string,
  responseText: string,
): boolean {
  if (!isAssistantServiceQuestion(userText) || containsRelationalPromptResidue(responseText)) {
    return false;
  }
  return questionSatisfiedMeaningfully(userText, responseText);
}

export function isCoherentAssistantSelfAnswer(
  userText: string,
  responseText: string,
): boolean {
  if (!isAssistantSelfQuestion(userText) || containsRelationalPromptResidue(responseText)) {
    return false;
  }
  return questionSatisfiedMeaningfully(userText, responseText);
}

export function isCoherentRelationalQuestionAnswer(
  userText: string,
  responseText: string,
): boolean {
  return (
    isCoherentMutualGetToKnowAnswer(userText, responseText) ||
    isCoherentAssistantServiceAnswer(userText, responseText) ||
    isCoherentAssistantSelfAnswer(userText, responseText)
  );
}
