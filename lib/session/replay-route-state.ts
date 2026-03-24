import type { DialogueRouteAct } from "../dialogue/router.ts";
import type { ProfileProgressRow } from "../db.ts";
import type { ProfileState } from "../profile.ts";
import {
  createSceneState,
  noteSceneStateAssistantTurn,
  noteSceneStateUserTurn,
  type SceneState,
} from "./scene-state.ts";
import {
  createSessionMemory,
  traceWriteUserAnswer,
  traceWriteUserQuestion,
  type SessionMemory,
} from "./session-memory.ts";
import {
  createSessionStateContract,
  reduceAssistantEmission,
  reduceUserTurn,
} from "./session-state-contract.ts";
import type { SessionInventoryItem } from "./session-inventory.ts";

type ReplayChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export function replaySceneFromMessages(input: {
  messages: ReplayChatMessage[];
  inventory: SessionInventoryItem[];
  deviceControlActive: boolean;
  profile: ProfileState;
  progress: Pick<ProfileProgressRow, "current_tier" | "free_pass_count" | "last_completion_summary">;
}): {
  sceneState: SceneState;
  sessionMemory: SessionMemory;
  latestAct: DialogueRouteAct;
} {
  let sceneState = createSceneState();
  let contract = createSessionStateContract("route-replay");
  let sessionMemory = createSessionMemory();
  let latestAct: DialogueRouteAct = "other";

  for (const message of input.messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      const reduced = reduceUserTurn(contract, {
        text: message.content,
        nowMs: Date.now(),
      });
      contract = reduced.next;
      const route = reduced.route;
      latestAct = route.act;
      const memoryTrace =
        route.act === "user_question" || route.act === "short_follow_up"
          ? traceWriteUserQuestion(sessionMemory, message.content, Date.now(), 0.9)
          : traceWriteUserAnswer(sessionMemory, message.content, Date.now(), null, 0.88);
      sessionMemory = memoryTrace.memory;
      sceneState = noteSceneStateUserTurn(sceneState, {
        text: message.content,
        act: route.act,
        sessionTopic: route.nextTopic,
        deviceControlActive: input.deviceControlActive,
        inventory: input.inventory,
        profile: input.profile,
        progress: input.progress,
      });
      continue;
    }
    sceneState = noteSceneStateAssistantTurn(sceneState, {
      text: message.content,
    });
    contract = reduceAssistantEmission(contract, {
      stepId: `route-replay-${Date.now()}`,
      content: message.content,
      isQuestion: message.content.includes("?"),
    });
  }

  return { sceneState, sessionMemory, latestAct };
}
