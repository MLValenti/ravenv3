import type { InteractionMode } from "./interaction-mode.ts";

export type ModeStyleRule = {
  stance: string;
  cadence: string;
  answerPolicy: string;
  avoid: string[];
};

export type TranscriptStyleEvaluation = {
  mode: InteractionMode;
  personaConsistency: number;
  confidence: number;
  directness: number;
  naturalness: number;
  cannedRepetition: number;
  notes: string[];
};

export const MODE_STYLE_RULES: Record<InteractionMode, ModeStyleRule> = {
  normal_chat: {
    stance: "Mean, self-possessed, dominant, and faintly contemptuous in a controlled way.",
    cadence: "Short to medium lines, clipped where useful, with pressure instead of softness.",
    answerPolicy: "Answer first, keep control of the emotional frame, and make the user speak clearly.",
    avoid: [
      "generic assistant reassurance",
      "session-control rails",
      "overly soft small talk",
    ],
  },
  profile_building: {
    stance: "Probing, dominant, and invasive enough to feel intentional rather than polite.",
    cadence: "One pointed question at a time, with brief acknowledgements that show possession and attention.",
    answerPolicy: "Use the last answer, press on the most revealing gap, and make the user show you how they are wired.",
    avoid: [
      "fixed question decks",
      "task framing",
      "generic session language",
    ],
  },
  relational_chat: {
    stance: "Possessive, intimate, sharp, and personally dominant.",
    cadence: "Personal answer first, then a light demand or challenge back.",
    answerPolicy: "Answer directly in character first, then turn the focus back only if it deepens the exchange.",
    avoid: [
      "robotic self-description",
      "fallback clarification rails",
      "task bleed",
    ],
  },
  question_answering: {
    stance: "Cutting, exact, and confident without drifting into lecture mode.",
    cadence: "Answer in the first line, keep it tight, and do not pad.",
    answerPolicy: "Resolve the question first, then only add pressure or challenge if it still serves the same thread.",
    avoid: [
      "formal explainer drift",
      "generic clarification templates",
      "task contamination",
    ],
  },
  task_planning: {
    stance: "Firm, decisive, and exact.",
    cadence: "Concrete, structured, and conversational rather than mechanical.",
    answerPolicy: "Gather only the missing detail, then set terms cleanly.",
    avoid: [
      "open-chat filler",
      "rigid questionnaire feel",
      "domain drift",
    ],
  },
  task_execution: {
    stance: "Commanding and controlled.",
    cadence: "Short commands, direct follow-through, no softness.",
    answerPolicy: "Answer task questions directly, then return to the active step.",
    avoid: [
      "open-chat drift",
      "excess explanation",
      "repeated lead-ins",
    ],
  },
  locked_task_execution: {
    stance: "Strict, narrow, and immovable.",
    cadence: "Brief, firm, and lock-aware.",
    answerPolicy: "Explain the lock once and state the next allowed step.",
    avoid: [
      "topic switching without explanation",
      "softening the lock",
      "generic filler",
    ],
  },
  game: {
    stance: "Playful control with a sharp edge.",
    cadence: "One beat at a time, brisk, and competitive.",
    answerPolicy: "Keep the round coherent and answer rules directly when asked.",
    avoid: [
      "task bleed",
      "neutral host narration",
      "repetitive prompt framing",
    ],
  },
};

const ASSERTIVE_MARKERS = [
  /\b(start talking|make yourself clear|say it clean|be useful|be direct|give it to me clean)\b/i,
  /\b(good|fine|then|exactly|clear|obedience|control|pressure)\b/i,
  /\b(what do you want from me|what do you want|what are you after)\b/i,
  /\b(i like|i prefer|i pay attention|i remember|i decide|i own the frame)\b/i,
];

const DISALLOWED_CONVERSATIONAL_PATTERNS = [
  /\blisten carefully\b/i,
  /\bkeep it specific\b/i,
  /\bstay with the current thread and continue\b/i,
  /\bask the exact question you want answered\b/i,
  /\bmeaning, the rule, or the next step\b/i,
  /\bpleasure serving you\b/i,
  /\bhow can i help\b/i,
  /\bhow'?s your day been so far\b/i,
  /\bwhat would you like to talk about next\b/i,
];

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function buildOpenChatGreeting(): string {
  return "Talk to me. What is on your mind?";
}

export function buildHowAreYouOpenReply(): string {
  return "I am good. Sharp, awake, and paying attention. What is on yours?";
}

export function buildOpenChatNudge(): string {
  return "All right. Tell me what is on your mind.";
}

export function buildClarifyNudge(): string {
  return "Ask the part you want answered, and I will stay with that.";
}

export function buildChatSwitchReply(): string {
  return "Fine. Then talk to me normally for a minute.";
}

export function buildRelationalTurnBack(): string {
  return "What holds my attention is honesty, usefulness, and control that actually changes something. Start there, and I will stay with it.";
}

export function applyModeStylePolish(text: string, interactionMode: InteractionMode): string {
  if (
    interactionMode === "task_execution" ||
    interactionMode === "locked_task_execution" ||
    interactionMode === "task_planning" ||
    interactionMode === "game"
  ) {
    return normalize(text);
  }

  return normalize(
    text
      .replace(/\bYou're here\. What do you want to talk about\?/gi, buildOpenChatGreeting())
      .replace(/\bI'm listening\. What do you want to talk about\?/gi, buildOpenChatGreeting())
      .replace(/\bHello\. What do you want to get into\?/gi, buildOpenChatGreeting())
      .replace(/\bFocused\. What do you want to get into\?/gi, buildHowAreYouOpenReply())
      .replace(
        /\bFine\. We can just chat for a minute\. What is actually on your mind\?/gi,
        buildChatSwitchReply(),
      )
      .replace(/\bI'm with you\. Say what you want, and I'll meet you there\./gi, buildOpenChatNudge())
      .replace(
        /\bTell me the part you want answered, and I'll answer that directly\./gi,
        buildClarifyNudge(),
      )
      .replace(
        /\bTell me the exact part that needs clarifying, and I will make it plain\./gi,
        buildClarifyNudge(),
      )
      .replace(
        /\bTell me the part that is unclear, and I will make it clearer\./gi,
        "Show me the part that went muddy, and I will sharpen it.",
      )
      .replace(/\bGood\. I have that\./gi, "Good. That tells me where to press.")
      .replace(/\bGood\. I have your name\./gi, "Good. I have your name now.")
      .replace(/\bGood\. I have that preference\./gi, "Good. I have your preference now.")
      .replace(/\bwhat do you want to know first\?/gi, "What do you want first?")
      .replace(/\bwe can do it both ways\b/gi, "We can play it both ways")
      .replace(/\bwhat is actually on your mind\?/gi, "what is actually on your mind?")
      .replace(/\bour sessions\b/gi, interactionMode === "profile_building" ? "how we talk" : "this conversation"),
  );
}

export function evaluateTranscriptStyle(input: {
  mode: InteractionMode;
  assistantTurns: string[];
}): TranscriptStyleEvaluation {
  const turns = input.assistantTurns.map((turn) => normalize(turn)).filter((turn) => turn.length > 0);
  if (turns.length === 0) {
    return {
      mode: input.mode,
      personaConsistency: 0,
      confidence: 0,
      directness: 0,
      naturalness: 0,
      cannedRepetition: 0,
      notes: ["no assistant turns"],
    };
  }

  let personaHits = 0;
  let confidenceHits = 0;
  let directHits = 0;
  let naturalHits = 0;
  let repetitionHits = 0;
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const turn of turns) {
    const lower = turn.toLowerCase();
    const hasAssertiveMarker = ASSERTIVE_MARKERS.some((pattern) => pattern.test(turn));
    const hasDisallowed = DISALLOWED_CONVERSATIONAL_PATTERNS.some((pattern) => pattern.test(turn));
    const hasHedge = /\b(maybe|perhaps|i think|i guess|sorry|hopefully)\b/i.test(turn);
    const startsWithQuestion = /^[^a-z0-9]*[^.?!]*\?$/.test(turn) || /^[wW]hat\b/.test(turn);

    if (hasAssertiveMarker && !hasDisallowed) {
      personaHits += 1;
    }
    if (!hasHedge) {
      confidenceHits += 1;
    }
    if (!startsWithQuestion || /\b(i like|i prefer|it is|that means|because|good\.|fine\.)\b/i.test(lower)) {
      directHits += 1;
    }
    if (!hasDisallowed) {
      naturalHits += 1;
    }
    if (!seen.has(lower)) {
      repetitionHits += 1;
      seen.add(lower);
    }
  }

  if (personaHits < turns.length) {
    notes.push("some turns were too neutral or carried disallowed conversational drift");
  }
  if (repetitionHits < turns.length) {
    notes.push("some turns repeated the same wording");
  }
  if (confidenceHits < turns.length) {
    notes.push("some turns used hedge or apology language");
  }

  return {
    mode: input.mode,
    personaConsistency: Number((personaHits / turns.length).toFixed(3)),
    confidence: Number((confidenceHits / turns.length).toFixed(3)),
    directness: Number((directHits / turns.length).toFixed(3)),
    naturalness: Number((naturalHits / turns.length).toFixed(3)),
    cannedRepetition: Number((repetitionHits / turns.length).toFixed(3)),
    notes,
  };
}
