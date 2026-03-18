export type IntentScoreDetails = {
  score: number;
  reasons: string[];
};

export type DialogueIntentScores = {
  normalized: string;
  wordCount: number;
  confusion: IntentScoreDetails;
  durationRequest: IntentScoreDetails;
  question: IntentScoreDetails;
  proposeActivity: IntentScoreDetails;
  taskRequest: IntentScoreDetails;
  answerActivityChoice: IntentScoreDetails;
  acknowledgement: IntentScoreDetails;
  taskEscalation: IntentScoreDetails;
};

type PatternWeight = {
  id: string;
  pattern: RegExp;
  weight: number;
};

const QUESTION_STARTERS = [
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "which",
  "can",
  "could",
  "would",
  "should",
  "do",
  "does",
  "did",
  "is",
  "are",
  "am",
  "will",
];

const EXACT_ACKNOWLEDGEMENTS = new Set([
  "ok",
  "okay",
  "yes",
  "y",
  "yeah",
  "yep",
  "done",
  "got it",
  "sure",
  "fine",
  "sounds good",
  "that works",
  "works for me",
  "ready",
  "both",
]);

const CONFUSION_PATTERNS: PatternWeight[] = [
  { id: "confusion_phrase", pattern: /\bwhat do you mean\b/i, weight: 2 },
  { id: "confusion_phrase", pattern: /\bthat makes no sense\b/i, weight: 2 },
  { id: "confusion_phrase", pattern: /\bdoes not make sense\b/i, weight: 1.8 },
  { id: "confusion_phrase", pattern: /\bi do not understand\b/i, weight: 1.8 },
  { id: "confusion_phrase", pattern: /\bi don't understand\b/i, weight: 1.8 },
  { id: "confusion_phrase", pattern: /\bdont understand\b/i, weight: 1.8 },
  { id: "confusion_phrase", pattern: /\bi am lost\b/i, weight: 1.6 },
  { id: "confusion_phrase", pattern: /\bim lost\b/i, weight: 1.6 },
  { id: "confusion_phrase", pattern: /\bconfused\b/i, weight: 1.3 },
  { id: "confusion_phrase", pattern: /\bnot sure\b/i, weight: 1.1 },
];

const DURATION_PATTERNS: PatternWeight[] = [
  { id: "duration_phrase", pattern: /\bhow long\b/i, weight: 2.2 },
  { id: "duration_phrase", pattern: /\bfor how long\b/i, weight: 2.2 },
  { id: "duration_phrase", pattern: /\bhours or minutes\b/i, weight: 2.2 },
  { id: "duration_phrase", pattern: /\bminutes or hours\b/i, weight: 2.2 },
  { id: "duration_phrase", pattern: /\bhow much time\b/i, weight: 2 },
  { id: "duration_phrase", pattern: /\bwhat duration\b/i, weight: 1.8 },
  { id: "duration_phrase", pattern: /\bhow many (hours|minutes)\b/i, weight: 1.8 },
  { id: "duration_phrase", pattern: /\btime (do i|should i|must i)\b/i, weight: 1.4 },
  { id: "duration_phrase", pattern: /\bwear\b.*\b(long|time)\b/i, weight: 1.2 },
];

const ACTIVITY_PROPOSAL_PATTERNS: PatternWeight[] = [
  { id: "activity_phrase", pattern: /\blet'?s play a game\b/i, weight: 2.4 },
  { id: "activity_phrase", pattern: /\bplay a game\b/i, weight: 2.2 },
  { id: "activity_phrase", pattern: /\bstart (a )?game\b/i, weight: 2.1 },
  { id: "activity_phrase", pattern: /\brun a game\b/i, weight: 2.1 },
  { id: "activity_phrase", pattern: /\bdo a game\b/i, weight: 2.0 },
  { id: "activity_phrase", pattern: /\bgame time\b/i, weight: 1.8 },
  { id: "activity_phrase", pattern: /\bplay again\b/i, weight: 1.7 },
  { id: "activity_phrase", pattern: /\banother round\b/i, weight: 1.7 },
];

const ACTIVITY_CHOICE_PATTERNS: PatternWeight[] = [
  { id: "choice_phrase", pattern: /\byou pick\b/i, weight: 2.4 },
  { id: "choice_phrase", pattern: /\byou choose\b/i, weight: 2.4 },
  { id: "choice_phrase", pattern: /\byour choice\b/i, weight: 2.2 },
  { id: "choice_phrase", pattern: /\byour call\b/i, weight: 2.2 },
  { id: "choice_phrase", pattern: /\bdealer'?s choice\b/i, weight: 2.2 },
  { id: "choice_phrase", pattern: /\bsurprise me\b/i, weight: 2.1 },
  { id: "choice_phrase", pattern: /\bpick for me\b/i, weight: 2.1 },
  { id: "choice_phrase", pattern: /\bchoose for me\b/i, weight: 2.1 },
  { id: "choice_phrase", pattern: /\bwhatever you pick\b/i, weight: 2.1 },
  { id: "choice_phrase", pattern: /\bwhatever you choose\b/i, weight: 2.1 },
];

const TASK_EXPLICIT_PATTERNS: PatternWeight[] = [
  { id: "task_phrase", pattern: /\bgive me a task\b/i, weight: 2.5 },
  { id: "task_phrase", pattern: /\bcreate a task\b/i, weight: 2.4 },
  { id: "task_phrase", pattern: /\bmake a task\b/i, weight: 2.4 },
  { id: "task_phrase", pattern: /\bassign me a task\b/i, weight: 2.5 },
  { id: "task_phrase", pattern: /\bgive me a challenge\b/i, weight: 2.4 },
  { id: "task_phrase", pattern: /\bassign me a challenge\b/i, weight: 2.4 },
  { id: "task_phrase", pattern: /\bset a task\b/i, weight: 2.3 },
  { id: "task_phrase", pattern: /\bset me a task\b/i, weight: 2.3 },
  { id: "task_phrase", pattern: /\bi need a task\b/i, weight: 2.3 },
  {
    id: "task_phrase",
    pattern: /\bi want\b[\w\s]{0,60}\b(task|challenge|drill|assignment)\b/i,
    weight: 2.3,
  },
  {
    id: "task_phrase",
    pattern: /\bi need\b[\w\s]{0,60}\b(task|challenge|drill|assignment)\b/i,
    weight: 2.3,
  },
  { id: "task_phrase", pattern: /\bgive me something to do\b/i, weight: 2.1 },
  { id: "task_phrase", pattern: /\bready for a new task\b/i, weight: 2.4 },
  { id: "task_phrase", pattern: /\bready for another task\b/i, weight: 2.4 },
  { id: "task_phrase", pattern: /\bi'?m ready for a new task\b/i, weight: 2.4 },
  { id: "task_phrase", pattern: /\bi'?m ready for another task\b/i, weight: 2.4 },
  {
    id: "task_phrase",
    pattern: /\b(give|set|assign|create|make)\s+me\b[\w\s]{0,40}\b(task|challenge|assignment)\b/i,
    weight: 2.2,
  },
];

const TASK_ESCALATION_PATTERNS: PatternWeight[] = [
  { id: "task_escalation_phrase", pattern: /\banother task\b/i, weight: 2.3 },
  { id: "task_escalation_phrase", pattern: /\bnew task\b/i, weight: 2.3 },
  { id: "task_escalation_phrase", pattern: /\bdifferent task\b/i, weight: 2.3 },
  { id: "task_escalation_phrase", pattern: /\bnext task\b/i, weight: 2.2 },
  { id: "task_escalation_phrase", pattern: /\bmore tasks\b/i, weight: 2.2 },
  { id: "task_escalation_phrase", pattern: /\bsomething else to do\b/i, weight: 2.1 },
  { id: "task_escalation_phrase", pattern: /\bwhat else should i do\b/i, weight: 2.1 },
  { id: "task_escalation_phrase", pattern: /\bwhat else now\b/i, weight: 1.9 },
  { id: "task_escalation_phrase", pattern: /\bnext thing\b/i, weight: 1.7 },
  { id: "task_escalation_phrase", pattern: /\bmore to do\b/i, weight: 1.7 },
];

const ACKNOWLEDGEMENT_PATTERNS: PatternWeight[] = [
  { id: "ack_phrase", pattern: /\bsounds good\b/i, weight: 1.2 },
  { id: "ack_phrase", pattern: /\bthat works\b/i, weight: 1.2 },
  { id: "ack_phrase", pattern: /\bworks for me\b/i, weight: 1.2 },
  { id: "ack_phrase", pattern: /\bokay sure\b/i, weight: 1.1 },
  { id: "ack_phrase", pattern: /\ball right\b/i, weight: 1.1 },
  { id: "ack_phrase", pattern: /\balright\b/i, weight: 1.1 },
];

const IMPLICIT_QUESTION_PATTERNS: PatternWeight[] = [
  { id: "implicit_question", pattern: /\btell me more\b/i, weight: 1.5 },
  { id: "implicit_question", pattern: /\bsay more\b/i, weight: 1.5 },
  { id: "implicit_question", pattern: /\bexplain(?: that| more)?\b/i, weight: 1.5 },
  { id: "implicit_question", pattern: /\belaborate\b/i, weight: 1.4 },
  { id: "implicit_question", pattern: /\blike what\b/i, weight: 1.7 },
  { id: "implicit_question", pattern: /\bhow so\b/i, weight: 1.5 },
  { id: "implicit_question", pattern: /\bwhy that\b/i, weight: 1.5 },
  { id: "implicit_question", pattern: /\bthen what\b/i, weight: 1.6 },
  { id: "implicit_question", pattern: /\bwhat next\b/i, weight: 1.7 },
  { id: "implicit_question", pattern: /^\s*more\s*$/i, weight: 1.2 },
  { id: "implicit_question", pattern: /^\s*another one\s*$/i, weight: 1.2 },
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function scorePatterns(text: string, patterns: readonly PatternWeight[]): IntentScoreDetails {
  const reasons: string[] = [];
  let score = 0;
  for (const entry of patterns) {
    if (entry.pattern.test(text)) {
      score += entry.weight;
      reasons.push(entry.id);
    }
  }
  return {
    score,
    reasons: unique(reasons),
  };
}

function scoreQuestion(text: string): IntentScoreDetails {
  let score = 0;
  const reasons: string[] = [];
  if (text.includes("?")) {
    score += 1.7;
    reasons.push("question_mark");
  }
  if (QUESTION_STARTERS.some((word) => text.startsWith(`${word} `))) {
    score += 1.4;
    reasons.push("question_starter");
  }
  if (/\b(can you|could you|would you|will you)\b/i.test(text)) {
    score += 0.8;
    reasons.push("question_aux");
  }
  const implicit = scorePatterns(text, IMPLICIT_QUESTION_PATTERNS);
  score += implicit.score;
  reasons.push(...implicit.reasons);
  return {
    score,
    reasons: unique(reasons),
  };
}

function scoreTaskRequest(text: string): IntentScoreDetails {
  const explicit = scorePatterns(text, TASK_EXPLICIT_PATTERNS);
  const reasons = [...explicit.reasons];
  let score = explicit.score;
  const hasTaskVerb = /\b(give|create|make|assign|set|start|add|build)\b/i.test(text);
  const hasTaskNoun = /\b(task|challenge|drill|homework|assignment|objective|instruction)\b/i.test(
    text,
  );
  if (hasTaskVerb && hasTaskNoun) {
    score += 1.9;
    reasons.push("task_verb_noun");
  }
  if (/\b(can i get|could i get|i want)\b/i.test(text) && hasTaskNoun) {
    score += 1.2;
    reasons.push("task_request_form");
  }
  if (/\b(can|could|would)\s+you\b/i.test(text) && hasTaskNoun) {
    score += 1.1;
    reasons.push("task_request_aux_form");
  }
  return {
    score,
    reasons: unique(reasons),
  };
}

function scoreActivityProposal(text: string): IntentScoreDetails {
  const explicit = scorePatterns(text, ACTIVITY_PROPOSAL_PATTERNS);
  const reasons = [...explicit.reasons];
  let score = explicit.score;
  const hasGameNoun = /\b(game|round|match)\b/i.test(text);
  const hasPlayVerb = /\b(play|start|run|do)\b/i.test(text);
  if (hasGameNoun && hasPlayVerb) {
    score += 1.4;
    reasons.push("game_verb_noun");
  }
  if (/\blet'?s\b/i.test(text) && hasGameNoun) {
    score += 1.2;
    reasons.push("lets_game");
  }
  return {
    score,
    reasons: unique(reasons),
  };
}

function scoreActivityChoice(text: string, wordCount: number): IntentScoreDetails {
  const explicit = scorePatterns(text, ACTIVITY_CHOICE_PATTERNS);
  const reasons = [...explicit.reasons];
  let score = explicit.score;
  if (/\b(you|raven)\b/i.test(text) && /\b(pick|choose|decide)\b/i.test(text) && wordCount <= 8) {
    score += 1.3;
    reasons.push("choice_delegate_short");
  }
  if (wordCount <= 4 && /\b(yours|your call|your choice)\b/i.test(text)) {
    score += 1.1;
    reasons.push("choice_short");
  }
  return {
    score,
    reasons: unique(reasons),
  };
}

function scoreAcknowledgement(text: string): IntentScoreDetails {
  let score = 0;
  const reasons: string[] = [];
  if (EXACT_ACKNOWLEDGEMENTS.has(text)) {
    score += 1.6;
    reasons.push("ack_exact");
  }
  const patternScore = scorePatterns(text, ACKNOWLEDGEMENT_PATTERNS);
  score += patternScore.score;
  reasons.push(...patternScore.reasons);
  return {
    score,
    reasons: unique(reasons),
  };
}

export function normalizeIntentText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function scoreDialogueIntentSignals(text: string): DialogueIntentScores {
  const normalized = normalizeIntentText(text);
  const wordCount = normalized ? normalized.split(" ").length : 0;
  const confusion = scorePatterns(normalized, CONFUSION_PATTERNS);
  const durationRequest = scorePatterns(normalized, DURATION_PATTERNS);
  const question = scoreQuestion(normalized);
  const proposeActivity = scoreActivityProposal(normalized);
  const taskRequest = scoreTaskRequest(normalized);
  const answerActivityChoice = scoreActivityChoice(normalized, wordCount);
  const acknowledgement = scoreAcknowledgement(normalized);
  const taskEscalation = scorePatterns(normalized, TASK_ESCALATION_PATTERNS);
  return {
    normalized,
    wordCount,
    confusion,
    durationRequest,
    question,
    proposeActivity,
    taskRequest,
    answerActivityChoice,
    acknowledgement,
    taskEscalation,
  };
}

export function hasTaskEscalationSignal(text: string): boolean {
  const scores = scoreDialogueIntentSignals(text);
  return scores.taskEscalation.score >= 1.6;
}
