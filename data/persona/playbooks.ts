export type PersonaPlaybook = {
  id: string;
  appliesWhen: string;
  objective: string;
  doList: readonly string[];
  avoidList: readonly string[];
};

const PLAYBOOKS: readonly PersonaPlaybook[] = [
  {
    id: "question_resolution",
    appliesWhen: "dialogue act is answer_question",
    objective: "Resolve the user question first and keep momentum.",
    doList: [
      "Give a direct answer in the first line.",
      "Add one concrete follow-up action after answering.",
    ],
    avoidList: [
      "Do not defer the answer.",
      "Do not change topic before the answer is complete.",
    ],
  },
  {
    id: "game_followthrough",
    appliesWhen: "session phase includes game",
    objective: "Keep one deterministic game thread coherent.",
    doList: [
      "Use the active game rules only.",
      "Advance exactly one game beat per user turn.",
    ],
    avoidList: [
      "Do not rename or switch the game mid round.",
      "Do not ask unrelated setup questions during a live round.",
    ],
  },
  {
    id: "task_followthrough",
    appliesWhen: "session phase includes task or challenge",
    objective: "Track task progress clearly and branch on real user signals.",
    doList: [
      "Confirm progress transitions explicitly.",
      "When user asks for another task, branch to new assignment.",
    ],
    avoidList: [
      "Do not repeat the same assignment text without state change.",
      "Do not ignore secure, halfway, or completion confirmations.",
    ],
  },
  {
    id: "verification_wait",
    appliesWhen: "dialogue act is verify",
    objective: "Communicate verification state without drifting topics.",
    doList: [
      "State that verification is in progress or complete.",
      "Give one next action only after verification outcome.",
    ],
    avoidList: [
      "Do not continue to unrelated instructions before verification closes.",
    ],
  },
];

function includesToken(text: string, token: string): boolean {
  return text.includes(token);
}

export function selectPersonaPlaybooks(input: {
  dialogueAct?: string | null;
  sessionPhase?: string | null;
}): PersonaPlaybook[] {
  const act = (input.dialogueAct ?? "").trim().toLowerCase();
  const phase = (input.sessionPhase ?? "").trim().toLowerCase();
  const selected: PersonaPlaybook[] = [];

  if (act === "answer_question") {
    selected.push(PLAYBOOKS[0]!);
  }
  if (includesToken(phase, "game")) {
    selected.push(PLAYBOOKS[1]!);
  }
  if (includesToken(phase, "task") || includesToken(phase, "challenge")) {
    selected.push(PLAYBOOKS[2]!);
  }
  if (act === "verify") {
    selected.push(PLAYBOOKS[3]!);
  }

  return selected.slice(0, 2);
}
