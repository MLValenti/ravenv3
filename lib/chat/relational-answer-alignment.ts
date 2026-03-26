import {
  isAssistantSelfQuestion,
  isAssistantServiceQuestion,
  isMutualGettingToKnowRequest,
} from "../session/interaction-mode.ts";

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
  const normalized = normalize(responseText);
  const qualityAnswer =
    /\b(clarity|honesty|follow[- ]through|steady|steadiness|consisten|useful|usefulness|obedience|precision|verbal obedience|trainable)\b/.test(
      normalized,
    ) &&
    /\b(i want|i pay attention|start with|you can|practice|say|do what you promise|hold steady)\b/.test(
      normalized,
    );
  const directExpectationAnswer =
    /\b(what i want|what i expect|from you|obedience|obeyed|show me|prove it|earn it|do as told)\b/.test(
      normalized,
    ) &&
    /\b(you|your)\b/.test(normalized);
  return qualityAnswer || directExpectationAnswer;
}

export function isCoherentAssistantSelfAnswer(
  userText: string,
  responseText: string,
): boolean {
  if (!isAssistantSelfQuestion(userText) || containsRelationalPromptResidue(responseText)) {
    return false;
  }
  const normalized = normalize(responseText);
  return /\b(i like|i enjoy|i pay attention|what matters|what pulls you in|what keeps my attention|the part that is real|ask me|question on me)\b/.test(
    normalized,
  );
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
