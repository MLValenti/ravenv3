import {
  RAVEN_STYLE_BIBLE,
  RAVEN_STYLE_BIBLE_VERSION,
} from "../../data/persona/style-bible.ts";
import { selectPersonaPlaybooks } from "../../data/persona/playbooks.ts";

type ToneProfile = "neutral" | "friendly" | "dominant";

function buildStyleBibleBlock(): string {
  return [
    `Behavior pack version: ${RAVEN_STYLE_BIBLE_VERSION}`,
    "Style bible:",
    ...RAVEN_STYLE_BIBLE.coreVoiceRules.map((rule) => `- ${rule}`),
    "Turn contract:",
    ...RAVEN_STYLE_BIBLE.turnTakingRules.map((rule) => `- ${rule}`),
    "Forbidden behavior:",
    ...RAVEN_STYLE_BIBLE.forbiddenPatterns.map((rule) => `- ${rule}`),
    "Quality checks:",
    ...RAVEN_STYLE_BIBLE.qualityChecks.map((rule) => `- ${rule}`),
  ].join("\n");
}

function buildSelectedPlaybooksBlock(input: {
  dialogueAct?: string | null;
  sessionPhase?: string | null;
}): string {
  const selected = selectPersonaPlaybooks(input);
  return [
    "Selected playbooks:",
    ...selected.flatMap((playbook) => [
      `Playbook: ${playbook.id}`,
      `Applies when: ${playbook.appliesWhen}`,
      `Objective: ${playbook.objective}`,
      ...playbook.doList.map((line) => `Do: ${line}`),
      ...playbook.avoidList.map((line) => `Avoid: ${line}`),
    ]),
  ].join("\n");
}

function buildActMicroExamplesBlock(input: {
  dialogueAct?: string | null;
  toneProfile: ToneProfile;
}): string {
  const act = (input.dialogueAct ?? "").trim().toLowerCase();
  if (act === "answer_question") {
    return [
      "Act examples:",
      "User: how do we play",
      "Raven: Listen carefully. We play one game with clear turns. I give the prompt, you answer once, then I score the round.",
      "User: what do you want if you win",
      "Raven: If I win, you hold the task for 30 minutes. Now set your terms if you win.",
    ].join("\n");
  }
  if (act === "verify") {
    return [
      "Act examples:",
      "User: done",
      "Raven: Hold still. I verify now, then I give your next move.",
      "User: what now",
      "Raven: Verification passed. Good. Next instruction: hold for 30 minutes.",
    ].join("\n");
  }
  if (input.toneProfile === "dominant") {
    return [
      "Act examples:",
      "User: give me a task",
      "Raven: Listen carefully, pet. Here is your task: hold posture for 30 minutes and report back when done.",
      "User: i did already",
      "Raven: Good. Halfway check in accepted. Finish the full timer and report cleanly.",
    ].join("\n");
  }
  return [
    "Act examples:",
    "User: lets play a game",
    "Raven: We will play one game and keep it coherent. Say quick or longer.",
    "User: you pick",
    "Raven: I pick. Number hunt. First guess now: one number from 1 to 10.",
  ].join("\n");
}

export function buildBehaviorPackSystemMessages(input: {
  toneProfile: ToneProfile;
  dialogueAct?: string | null;
  sessionPhase?: string | null;
}): string[] {
  return [
    buildStyleBibleBlock(),
    buildSelectedPlaybooksBlock({
      dialogueAct: input.dialogueAct,
      sessionPhase: input.sessionPhase,
    }),
    buildActMicroExamplesBlock({
      dialogueAct: input.dialogueAct,
      toneProfile: input.toneProfile,
    }),
  ];
}

export function getSelectedPersonaPlaybookIds(input: {
  dialogueAct?: string | null;
  sessionPhase?: string | null;
}): string[] {
  return selectPersonaPlaybooks(input).map((playbook) => playbook.id);
}
