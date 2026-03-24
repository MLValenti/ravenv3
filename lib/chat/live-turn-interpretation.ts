import { classifyCoreConversationMove, type CoreConversationMove } from "./core-turn-move.ts";
import {
  selectDialogueAct,
  type DialogueAct,
  type DialogueActInput,
} from "./conversation-quality.ts";
import { classifyDialogueRoute, type DialogueRouteAct } from "../dialogue/router.ts";
import { classifyUserIntent, type UserIntent } from "../session/intent-router.ts";

export type LiveRouteTurnInterpretationInput = DialogueActInput & {
  lastUserMessage: string;
  previousAssistantMessage?: string | null;
  currentTopic?: string | null;
};

export type LiveRouteTurnInterpretation = {
  dialogueAct: DialogueAct;
  latestUserIntent: UserIntent;
  latestRouteAct: DialogueRouteAct;
  latestRouteReason: string;
  latestCoreConversationMove: CoreConversationMove | null;
  classifyUserIntentForState: (text: string, awaitingUser: boolean) => UserIntent;
  classifyRouteActForState: (text: string, awaitingUser: boolean) => DialogueRouteAct;
};

export function classifyRouteActForState(text: string, awaitingUser: boolean): DialogueRouteAct {
  return classifyDialogueRoute({
    text,
    awaitingUser,
    currentTopic: null,
    nowMs: Date.now(),
  }).act;
}

export function interpretLiveRouteTurn(
  input: LiveRouteTurnInterpretationInput,
): LiveRouteTurnInterpretation {
  const dialogueAct = selectDialogueAct(input);
  const latestUserIntent = classifyUserIntent(input.lastUserMessage, input.awaitingUser);
  const latestRoute = classifyDialogueRoute({
    text: input.lastUserMessage,
    awaitingUser: input.awaitingUser,
    currentTopic: null,
    nowMs: Date.now(),
  });
  const latestCoreConversationMove = input.lastUserMessage.trim()
    ? classifyCoreConversationMove({
        userText: input.lastUserMessage,
        previousAssistantText: input.previousAssistantMessage ?? null,
        currentTopic: input.currentTopic ?? null,
      })
    : null;
  return {
    dialogueAct,
    latestUserIntent,
    latestRouteAct: latestRoute.act,
    latestRouteReason: latestRoute.reason,
    latestCoreConversationMove,
    classifyUserIntentForState: classifyUserIntent,
    classifyRouteActForState,
  };
}
