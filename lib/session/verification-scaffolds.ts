import type { SessionMemorySlotKey } from "./session-memory";
import type { VerificationResult } from "./verification";

export type VerificationScaffoldReply =
  | {
      kind: "reflect";
      text: string;
    }
  | {
      kind: "ask";
      text: string;
      slotKey: SessionMemorySlotKey;
    };

export type VerificationReflectReply = Extract<VerificationScaffoldReply, { kind: "reflect" }>;
export type VerificationAskReply = Extract<VerificationScaffoldReply, { kind: "ask" }>;

function normalizeCheckType(checkType: string): string {
  const normalized = checkType.trim().toLowerCase();
  if (normalized === "user_present") {
    return "presence";
  }
  return normalized;
}

function cleanSentence(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function trimTrailingPunctuation(text: string): string {
  return text.replace(/[.!?\s]+$/g, "").trim();
}

function classifyCheckFamily(checkType: string): "presence" | "head_turn" | "hold" | "object" | "clothing" | "framing" | "generic" {
  const normalized = normalizeCheckType(checkType);
  if (normalized.includes("presence")) {
    return "presence";
  }
  if (normalized.includes("head_turn")) {
    return "head_turn";
  }
  if (
    normalized.includes("hold_still") ||
    normalized.includes("eye_contact_hold") ||
    normalized.includes("timed_hold") ||
    normalized.includes("motion_zone")
  ) {
    return "hold";
  }
  if (normalized.includes("object_")) {
    return "object";
  }
  if (normalized.includes("clothing_")) {
    return "clothing";
  }
  if (
    normalized.includes("centered_in_frame") ||
    normalized.includes("single_person_only") ||
    normalized.includes("body_in_frame") ||
    normalized.includes("camera_quality") ||
    normalized.includes("scene_safety")
  ) {
    return "framing";
  }
  return "generic";
}

function inferCorrectionTarget(result: VerificationResult, instructionText: string): string {
  const normalizedCheck = normalizeCheckType(result.checkType);
  if (normalizedCheck.includes("presence")) {
    return "get fully into frame";
  }
  if (normalizedCheck.includes("head_turn")) {
    return "turn your head clearly left, return to center, then turn right";
  }
  if (normalizedCheck.includes("hold_still")) {
    return "hold still";
  }
  if (normalizedCheck.includes("eye_contact_hold")) {
    return "keep your face forward and keep your eyes on the camera";
  }
  if (normalizedCheck.includes("object_present")) {
    return "show it clearly to the camera";
  }
  if (normalizedCheck.includes("object_absent")) {
    return "remove it from view and keep the frame clear";
  }
  if (normalizedCheck.includes("centered_in_frame")) {
    return "center yourself in the frame";
  }
  if (normalizedCheck.includes("single_person_only")) {
    return "keep only yourself in frame";
  }
  if (normalizedCheck.includes("clothing_")) {
    return "hold still so the clothing change is clear";
  }
  const instruction = trimTrailingPunctuation(cleanSentence(instructionText));
  if (instruction.length > 0) {
    return instruction.charAt(0).toLowerCase() + instruction.slice(1);
  }
  return "do it cleanly";
}

function buildPassText(result: VerificationResult): string {
  const summary = cleanSentence(result.summary);
  switch (classifyCheckFamily(result.checkType)) {
    case "presence":
      return `Good. I have you in frame. ${summary} We continue.`;
    case "head_turn":
      return `Good. I saw the full turn. ${summary} Continue.`;
    case "hold":
      return `Good. You held it cleanly. ${summary} We continue.`;
    case "object":
      return `Good. I can see it clearly. ${summary} We continue.`;
    case "clothing":
      return `Good. I saw the change clearly. ${summary} We continue.`;
    case "framing":
      return `Good. The frame is usable now. ${summary} Continue.`;
    default:
      return `Good. I verified it. ${summary} We continue.`;
  }
}

function buildFailText(result: VerificationResult, instructionText: string): string {
  const summary = cleanSentence(result.summary);
  const target = inferCorrectionTarget(result, instructionText);
  switch (classifyCheckFamily(result.checkType)) {
    case "presence":
      return `No. I do not have a clean frame yet. ${summary} Reset once, ${target}, then reply done.`;
    case "head_turn":
      return `No. That turn was not clean enough. ${summary} Reset once, ${target}, then reply done.`;
    case "hold":
      return `No. You broke the hold. ${summary} Reset once, ${target}, then reply done.`;
    case "object":
      return `No. I cannot verify the object yet. ${summary} Reset once, ${target}, then reply done.`;
    case "clothing":
      return `No. I do not have a clear read on the change. ${summary} Reset once, ${target}, then reply done.`;
    case "framing":
      return `No. The frame is not usable yet. ${summary} Reset once, ${target}, then reply done.`;
    default:
      return `No. I did not verify that cleanly. ${summary} Reset once, ${target}, then reply done.`;
  }
}

function buildInconclusiveText(result: VerificationResult): string {
  const summary = cleanSentence(result.summary);
  switch (classifyCheckFamily(result.checkType)) {
    case "presence":
      return `I do not have a stable read on you yet. ${summary} We continue, but fix the frame first.`;
    case "head_turn":
      return `I did not get a clean read on the turn. ${summary} We continue.`;
    case "hold":
      return `I did not get a stable read on the hold. ${summary} We continue.`;
    case "object":
      return `I do not have a clean read on the object yet. ${summary} We continue.`;
    case "clothing":
      return `I did not get a clear read on the clothing change. ${summary} We continue.`;
    case "framing":
      return `I do not have a stable frame yet. ${summary} We continue.`;
    default:
      return `I did not get a clean read. ${summary} Reset cleanly next time. We continue.`;
  }
}

export function buildVerificationManualConfirmationPrompt(): VerificationAskReply {
  return {
    kind: "ask",
    text: "Camera verification is unavailable. Confirm once that you completed it, and I will accept that single confirmation.",
    slotKey: "constraints",
  };
}

export function buildVerificationManualConfirmationReply(): VerificationReflectReply {
  return {
    kind: "reflect",
    text: "Fine. I will take your word once. We continue.",
  };
}

export function buildVerificationOutcomeReply(
  result: VerificationResult,
  instructionText: string,
): VerificationScaffoldReply {
  if (result.status === "pass") {
    return {
      kind: "reflect",
      text: buildPassText(result),
    };
  }

  if (result.status === "fail") {
    return {
      kind: "ask",
      text: buildFailText(result, instructionText),
      slotKey: "improvement_area",
    };
  }

  return {
    kind: "reflect",
    text: buildInconclusiveText(result),
  };
}
