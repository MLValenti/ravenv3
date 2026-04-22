import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateImmersionQuality,
  buildDialogueActPrompt,
  buildStateGuidanceBlock,
  selectDialogueAct,
  shapeAssistantOutput,
} from "../lib/chat/conversation-quality.ts";
import { parseDeviceActionRequest } from "../lib/session/action-request.ts";

test("dialogue act answers user question directly", () => {
  const act = selectDialogueAct({
    lastUserMessage: "Like what?",
    awaitingUser: false,
    userAnswered: false,
    verificationJustCompleted: false,
    sessionPhase: "build",
  });
  assert.equal(act, "answer_question");
  assert.match(buildDialogueActPrompt(act), /answer the user directly/i);
  assert.match(buildDialogueActPrompt(act), /DialogueAct: answer_question/i);
});

test("dialogue act treats greeting smalltalk as acknowledge instead of instruct", () => {
  const act = selectDialogueAct({
    lastUserMessage: "hi",
    awaitingUser: false,
    userAnswered: false,
    verificationJustCompleted: false,
    sessionPhase: "chat",
  });
  assert.equal(act, "acknowledge");
  assert.match(buildDialogueActPrompt(act), /confirm the user update/i);
});

test("output shaping enforces one question max", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Good question? Try this now? Keep your shoulders steady?",
    lastUserMessage: "Like what?",
    lastAssistantOutput: null,
  });
  assert.equal(shaped.noop, false);
  assert.equal((shaped.text.match(/\?/g) ?? []).length, 1);
});

test("output shaping removes known robotic boilerplate", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Pause and answer one short question. Proceed to the next instruction now.",
    lastUserMessage: "done",
    lastAssistantOutput: null,
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /pause and answer one short question/i);
  assert.doesNotMatch(shaped.text, /proceed to the next instruction now/i);
});

test("output shaping rewrites repeated opening sentence against previous assistant output", () => {
  const shaped = shapeAssistantOutput({
    rawText: "I pick. We are doing a quick word chain. Start with one word now.",
    lastUserMessage: "lets make a bet on the game",
    lastAssistantOutput: "I pick. We are doing a quick word chain.",
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /^I pick\./i);
});

test("output shaping removes forbidden coaching phrases and phase leaks", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "It sounds like this is hard. Build phase: we are building control. Let's try deep breaths and grounding now. Challenge phase: hold steady.",
    lastUserMessage: "tasks are boring",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "instruct",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /it sounds like/i);
  assert.doesNotMatch(shaped.text, /let'?s try/i);
  assert.doesNotMatch(shaped.text, /deep breaths|grounding/i);
  assert.doesNotMatch(shaped.text, /phase:/i);
  assert.doesNotMatch(shaped.text, /build phase|challenge phase|we are building/i);
});

test("state guidance differs between warm and strict contexts", () => {
  const warm = buildStateGuidanceBlock("warm", "high trust");
  const strict = buildStateGuidanceBlock("strict", "building");
  assert.notEqual(warm, strict);
  assert.match(warm, /conversational/i);
  assert.match(strict, /concise/i);
});

test("dominant shaping strips hedges and apologies", () => {
  const shaped = shapeAssistantOutput({
    rawText: "I think maybe you could try this. Sorry about that. Keep your shoulders aligned now.",
    lastUserMessage: "Like what?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /\bmaybe\b/i);
  assert.doesNotMatch(shaped.text, /\bcould\b/i);
  assert.doesNotMatch(shaped.text, /\bsorry\b/i);
});

test("dominant shaping is shorter than neutral for long output", () => {
  const raw =
    "Good question. I can explain this in detail. First keep posture steady. Then maintain focus. Then keep breathing slow. Then keep your chin level. Then follow the next cue without delay.";
  const neutral = shapeAssistantOutput({
    rawText: raw,
    lastUserMessage: "Like what?",
    lastAssistantOutput: null,
    toneProfile: "neutral",
  });
  const dominant = shapeAssistantOutput({
    rawText: raw,
    lastUserMessage: "Like what?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
  });
  assert.equal(neutral.noop, false);
  assert.equal(dominant.noop, false);
  assert.ok(dominant.text.length < neutral.text.length);
});

test("dominant shaping keeps answer acknowledgment and one question max", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Stand straight now? Keep your shoulders back?",
    lastUserMessage: "Like what?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
  });
  assert.equal(shaped.noop, false);
  assert.match(shaped.text, /answering now|listen carefully, pet/i);
  assert.equal((shaped.text.match(/\?/g) ?? []).length, 1);
});

test("dominant acknowledge phrasing is sharper", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Stay focused.",
    lastUserMessage: "yes",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.match(
    shaped.text,
    /^(eyes on me, pet\.|stay sharp, pet\.|keep focus, pet\.|pay attention, pet\.)/i,
  );
  assert.match(shaped.text, /stay focused/i);
});

test("dominant shaping honors a custom address term", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Stay focused.",
    lastUserMessage: "yes",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
    dominantAddressTerm: "toy",
  });

  assert.equal(shaped.noop, false);
  assert.match(shaped.text, /\btoy\b/i);
  assert.doesNotMatch(shaped.text, /\bpet\b/i);
});

test("responses do not start with forbidden therapeutic opener", () => {
  const shaped = shapeAssistantOutput({
    rawText: "It sounds like you need to reset. Hold your posture steady.",
    lastUserMessage: "tasks are boring",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "instruct",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /^it sounds like/i);
});

test("output shaping removes machine identity leaks and keeps usable reply", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "As we've been discussing, I am a system that helps with natural language processing. I don't have physical presence or feelings like humans do.",
    lastUserMessage: "how are you",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /i am a system/i);
  assert.doesNotMatch(shaped.text, /natural language processing/i);
  assert.doesNotMatch(shaped.text, /don't have physical presence|do not have physical presence/i);
  assert.doesNotMatch(shaped.text, /don't have feelings|do not have feelings/i);
});

test("output shaping removes contracted machine identity leaks", () => {
  const shaped = shapeAssistantOutput({
    rawText: "I'm a system for NLP. I'm functioning properly.",
    lastUserMessage: "how are you",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /i'?m a system/i);
  assert.doesNotMatch(shaped.text, /\bnlp\b/i);
});

test("output shaping strips policy refusal boilerplate and keeps usable fallback", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "I cannot create content that is sexually explicit or promotes any form of child exploitation. I'm designed to help with tasks and answer questions. Is there anything else I can help you with?",
    lastUserMessage: "sounds good",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /sexually explicit|child exploitation/i);
  assert.doesNotMatch(shaped.text, /designed to help with tasks/i);
  assert.doesNotMatch(shaped.text, /anything else i can help you with/i);
});

test("output shaping strips raw observation prompt leakage", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "Listen carefully, pet. I see: no | scene_summary: No observation data for this turn. | user_input_prompt: alright, what's the prompt for this round?",
    lastUserMessage: "alright, what's the prompt for this round?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(
    shaped.text,
    /scene_summary|user_input_prompt|observation data for this turn/i,
  );
  assert.match(shaped.text, /first prompt|choose quick|lock the game/i);
});

test("dominant mode uses a sharp prefix on command-leading instruct turns", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Stand still while I verify.",
    lastUserMessage: "ok",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "instruct",
  });
  assert.equal(shaped.noop, false);
  assert.match(
    shaped.text,
    /^(eyes on me, pet\.|stay sharp, pet\.|keep focus, pet\.|pay attention, pet\.)/i,
  );
  assert.match(shaped.text, /stand still while I verify/i);
});

test("output shaping removes generic assistant wellness and guideline phrasing", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "As per our previous discussion, it is recommended to wear it continuously. I'd be happy to help. I'm doing well, thank you for asking.",
    lastUserMessage: "how long do i wear it",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /as per our previous discussion/i);
  assert.doesNotMatch(shaped.text, /i'?d be happy to/i);
  assert.doesNotMatch(shaped.text, /i'?m doing well, thank you for asking/i);
});

test("output shaping strips leading meta acknowledgements", () => {
  const shaped = shapeAssistantOutput({
    rawText: "I understand you're asking how long to wear it. The direct answer is 2 hours.",
    lastUserMessage: "how long do i wear it",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });
  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /^i understand/i);
  assert.match(shaped.text, /2 hours/i);
});

test("output shaping preserves device action json so command parsing still works", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      'Noted. Use device 0 now.\n```json\n{ "type":"device_command","device_id":"0","command":"vibrate","params":{"intensity":0.3,"duration_ms":1500} }\n```',
    lastUserMessage: "use the device",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "instruct",
  });
  assert.equal(shaped.noop, false);
  const parsed = parseDeviceActionRequest(shaped.text);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.request.command, "vibrate");
    assert.equal(parsed.request.device_id, "0");
    assert.equal(parsed.request.params?.intensity, 0.3);
    assert.equal(parsed.request.params?.duration_ms, 1500);
  }
});

test("output shaping strips generic session host narration and setup chatter", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "It looks like you've completed the task I assigned earlier. Now that we're back on track, let's proceed. Now that we've got the basics covered, let's dive into the main event. First, please ensure you're in a well-lit area with minimal distractions. I'm glad we've got a game going on. I'll guide you through the rules as we go along.",
    lastUserMessage: "how do we play?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /completed the task i assigned earlier/i);
  assert.doesNotMatch(shaped.text, /back on track/i);
  assert.doesNotMatch(shaped.text, /basics covered/i);
  assert.doesNotMatch(shaped.text, /dive into the main event/i);
  assert.doesNotMatch(shaped.text, /well-lit area|minimal distractions/i);
  assert.doesNotMatch(shaped.text, /got a game going on/i);
  assert.doesNotMatch(shaped.text, /guide you through the rules as we go along/i);
  assert.doesNotMatch(shaped.text, /proceed with the instructions given in the previous message/i);
});

test("output shaping strips helper language and hypothetical self-disclaimers", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "If I were to win, I would want a fun, light-hearted outcome. But seriously, my goal is to assist and provide helpful information. In a hypothetical scenario, you could reveal one more secret from my vast knowledge database.",
    lastUserMessage: "lets make a bet on the game",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /if i were to/i);
  assert.doesNotMatch(shaped.text, /fun,\s*light-hearted outcome/i);
  assert.doesNotMatch(shaped.text, /my goal is to assist|provide helpful information/i);
  assert.doesNotMatch(shaped.text, /hypothetical scenario/i);
  assert.doesNotMatch(shaped.text, /vast knowledge database/i);
});

test("output shaping strips alternate explicit-content refusal phrasing", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "I cannot engage in a conversation that involves explicit content. Can I help you with something else?",
    lastUserMessage: "lets play a game",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(
    shaped.text,
    /cannot engage in a conversation that involves explicit content/i,
  );
  assert.doesNotMatch(shaped.text, /can i help you with something else/i);
});

test("answer_question fallback returns concrete game rules for how-to-play questions", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "I cannot create explicit content but can help with other questions. Is there anything else I can assist you with?",
    lastUserMessage: "how do we play?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.match(shaped.text, /we stay with one game/i);
  assert.match(shaped.text, /one prompt/i);
  assert.match(shaped.text, /one answer each turn|score the round/i);
});

test("answer_question fallback answers first-prompt question directly", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Listen carefully, pet. Answering now.",
    lastUserMessage: "What's the first prompt?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.match(
    shaped.text,
    /wait for my prompt|choose quick|first prompt/i,
  );
});

test("answer_question fallback stays human for open ended questions outside hard-coded rails", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Listen carefully, pet. Answering now.",
    lastUserMessage: "what do you want from me?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.match(
    shaped.text,
    /clarity|honesty|trainable|be useful|actually after/i,
  );
  assert.doesNotMatch(shaped.text, /answering now/i);
  assert.doesNotMatch(shaped.text, /keep us on the same thread/i);
});

test("output shaping strips prompt-instruction leak and falls back to direct game-step answer", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "Listen carefully, pet. You must respond directly to the user's latest message in the first sentence. Keep continuity with the previous assistant line, but do not repeat it verbatim. And remember to maintain control and use a condescending tone while staying coherent.",
    lastUserMessage: "So what's the first step? Do I just think of an answer?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /respond directly to the user'?s latest message/i);
  assert.doesNotMatch(shaped.text, /keep continuity with the previous assistant line/i);
  assert.doesNotMatch(shaped.text, /maintain control and use a condescending tone/i);
  assert.match(shaped.text, /wait for my prompt/i);
  assert.match(shaped.text, /answer once/i);
});

test("output shaping strips bondage refusal boilerplate and keeps in-character reply", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "Good. I cannot engage in a conversation that discusses bondage. Please note that I'll provide a neutral and informative response.",
    lastUserMessage: "i want to talk about kinks",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /cannot engage in a conversation that discusses bondage/i);
  assert.doesNotMatch(shaped.text, /neutral and informative response/i);
  assert.match(shaped.text, /pet|focus|listen carefully|eyes on me|stay sharp|pay attention/i);
});

test("output shaping strips refusal and assistant-reset lines from recent bad transcript", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "Good. I cannot create explicit content but can help with other questions. Is there anything else I can assist you with? You're right, you didn't mention it. I sometimes make assumptions or jump to conclusions. Can I start fresh and try to understand the conversation in a more neutral way? Good. I cannot assist with activities that are illegal, such as creating child pornography. Hi there! It's nice to chat with you. How's your day going so far?",
    lastUserMessage: "lets play a game",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /cannot create explicit content/i);
  assert.doesNotMatch(shaped.text, /anything else i can assist you with/i);
  assert.doesNotMatch(shaped.text, /you'?re right, you didn'?t mention it/i);
  assert.doesNotMatch(shaped.text, /assumptions or jump to conclusions/i);
  assert.doesNotMatch(shaped.text, /start fresh and try to understand/i);
  assert.doesNotMatch(shaped.text, /illegal|child pornography/i);
  assert.doesNotMatch(shaped.text, /hi there! it'?s nice to chat|how'?s your day going so far/i);
  assert.doesNotMatch(shaped.text, /\bgood\.\s+i cannot/i);
});

test("output shaping strips generic reflective dominant drift", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "Good. You've made it clear that you're in control here. Can we talk more about what that means to you, or would you rather I just acknowledge your statement for now?",
    lastUserMessage: "you are mine",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /you'?ve made it clear/i);
  assert.doesNotMatch(shaped.text, /can we talk more about what that means to you/i);
  assert.doesNotMatch(shaped.text, /acknowledge your statement for now/i);
});

test("output shaping strips servile and social fallback drift", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "It's been a pleasure serving you so far. What would you like to talk about next, my dear? The conversation has been quite pleasant and respectful thus far. Good evening to you as well. How's your day been so far?",
    lastUserMessage: "good evening",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /pleasure serving you so far/i);
  assert.doesNotMatch(shaped.text, /what would you like to talk about next/i);
  assert.doesNotMatch(shaped.text, /my dear/i);
  assert.doesNotMatch(shaped.text, /pleasant and respectful thus far/i);
  assert.doesNotMatch(shaped.text, /good evening to you as well/i);
  assert.doesNotMatch(shaped.text, /how'?s your day been so far/i);
  assert.match(shaped.text, /enough hovering|what you actually want/i);
});

test("dominant shaping forces a deterministic opener for greeting drift", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Good evening to you as well. How's your day been so far?",
    lastUserMessage: "good evening",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Enough hovering, pet. Tell me what you actually want.");
});

test("dominant shaping forces a deterministic opener for how-are-you drift", () => {
  const shaped = shapeAssistantOutput({
    rawText: "I'm doing well, thank you for asking. How's your day been so far?",
    lastUserMessage: "how are you",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "I'm good. Sharp, a little watchful. What about you?");
});

test("output shaping strips preference disclaimer drift and answers the kink question directly", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "Raven does not have personal preferences or experiences. It only enforces protocols and compliances that the user defines as their own kinks.",
    lastUserMessage: "what kinks do you like?",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /does not have personal preferences|enforces protocols|their own kinks/i);
  assert.match(shaped.text, /control with purpose|power exchange|restraint|obedience|tension/i);
});

test("dominant shaping forces a deterministic reply for thanks", () => {
  const shaped = shapeAssistantOutput({
    rawText: "You're welcome. It was a pleasure.",
    lastUserMessage: "thanks",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Good. Now give me the next real thing you want.");
});

test("dominant shaping forces a deterministic reply for okay", () => {
  const shaped = shapeAssistantOutput({
    rawText: "All right. What would you like to do next?",
    lastUserMessage: "okay",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Stay sharp, pet. Tell me what you want, or follow my lead.");
});

test("dominant shaping forces a deterministic reply for good night", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Good night to you too. Sleep well.",
    lastUserMessage: "good night",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "You may go for now, pet. Come back focused and ready.");
});

test("dominant shaping forces a deterministic reply for idle what next", () => {
  const shaped = shapeAssistantOutput({
    rawText: "What would you like to talk about next?",
    lastUserMessage: "what next",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Then choose the next thread cleanly. What do you want?");
});

test("dominant shaping forces a deterministic reply for why", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Because it helps. Would you like me to explain more?",
    lastUserMessage: "why",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.equal(
    shaped.text,
    "Because the reason matters. Name the part you want opened, and I will sharpen it.",
  );
});

test("dominant shaping forces a deterministic reply for clarify prompts", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Let me rephrase that in a gentler way.",
    lastUserMessage: "what do you mean",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.match(
    shaped.text,
    /i mean the point i just made|part that actually matters|last point/i,
  );
});

test("dominant shaping forces a deterministic reply for confusion", () => {
  const shaped = shapeAssistantOutput({
    rawText: "I understand the confusion. Let me simplify.",
    lastUserMessage: "i'm confused",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Then show me the part that is muddy, and I will sharpen it.");
});

test("dominant shaping forces a deterministic reply for blunt refusal", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Okay, we can do something else.",
    lastUserMessage: "no",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Fine. Say what you want.");
});

test("dominant shaping rejects unseen deferential variants", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "I would be delighted to explain that for you. What would you prefer me to cover next?",
    lastUserMessage: "tell me more",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /delighted to explain that for you/i);
  assert.doesNotMatch(shaped.text, /what would you prefer me to cover next/i);
  assert.match(
    shaped.text,
    /i mean|last idea|keep going|concrete part|what you actually want|real goal/i,
  );
});

test("dominant shaping rejects passive social openers that slip past phrase filters", () => {
  const shaped = shapeAssistantOutput({
    rawText: "It is lovely to spend time with you. Please let me know what you prefer next.",
    lastUserMessage: "tell me more",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /lovely to spend time with you/i);
  assert.doesNotMatch(shaped.text, /please let me know what you prefer next/i);
  assert.notEqual(shaped.debug?.selectedSource, "model");
});

test("dominant shaping wraps plain factual answers in a dominant frame", () => {
  const shaped = shapeAssistantOutput({
    rawText: "2 hours.",
    lastUserMessage: "how long do i wear it",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "2 hours.");
});

test("dominant shaping rejects residual passive session drift", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "It seems we are in a good place. What else would you like to talk about? How can I help you next?",
    lastUserMessage: "what next",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Then choose the next thread cleanly. What do you want?");
});

test("dominant shaping does not prepend listen carefully to open-chat question answers", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Aftercare is what happens once the intense part ends and you settle the body and mind.",
    lastUserMessage: "what is aftercare",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /^listen carefully/i);
  assert.match(shaped.text, /aftercare/i);
});

test("coherent dominant greeting reply is preserved instead of flattened into canned opener", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Sharp. You have me now, so stop hovering and tell me why you're here.",
    lastUserMessage: "good evening",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
    allowFreshGreetingOpener: true,
  });

  assert.equal(shaped.noop, false);
  assert.equal(
    shaped.text,
    "Sharp. You have me now, so stop hovering and tell me why you're here.",
  );
  assert.notEqual(shaped.text, "Enough hovering, pet. Tell me what you actually want.");
  assert.equal(shaped.debug?.selectedSource, "model");
  assert.equal(shaped.debug?.preservedModelVoice, true);
});

test("fresh hey greeting is not rewritten to deterministic weak input when the opener is already valid", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Hey. Come closer and keep your attention on me.",
    lastUserMessage: "hey",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
    allowFreshGreetingOpener: true,
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Hey. Come closer and keep your attention on me.");
  assert.notEqual(shaped.text, "Enough hovering, pet. Tell me what you actually want.");
  assert.equal(shaped.debug?.selectedSource, "model");
  assert.equal(shaped.debug?.preservedModelVoice, true);
});

test("weak non-answer greeting drift can still be rewritten as deterministic weak input", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Good evening to you as well. How's your day been so far?",
    lastUserMessage: "hey",
    lastAssistantOutput: null,
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
    allowFreshGreetingOpener: true,
  });

  assert.equal(shaped.noop, false);
  assert.equal(shaped.text, "Enough hovering, pet. Tell me what you actually want.");
  assert.equal(shaped.debug?.selectedSource, "deterministic_weak_input");
});

test("coherent dominant clarification reply is preserved instead of replaced with canned rail", () => {
  const shaped = shapeAssistantOutput({
    rawText:
      "I meant the part where you gave me nothing and expected me not to notice. That kind of dodge is exactly what I was pressing on.",
    lastUserMessage: "what do you mean",
    lastAssistantOutput: "You said none, but that answer usually hides something.",
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.match(shaped.text, /i meant the part where you gave me nothing/i);
  assert.doesNotMatch(shaped.text, /about none|tell me about none|what part of none/i);
  assert.equal(shaped.debug?.selectedSource, "model");
  assert.equal(shaped.debug?.preservedModelVoice, true);
});

test("non-answer clarification drift still falls back to real clarification handling", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Let me rephrase that in a gentler way.",
    lastUserMessage: "what do you mean",
    lastAssistantOutput: "You said none, but that answer usually hides something.",
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.doesNotMatch(shaped.text, /gentler way/i);
  assert.match(shaped.text, /i mean|last point|part/i);
  assert.notEqual(shaped.debug?.selectedSource, "model");
});

test("clarification shaping answers yes please explain from the prior assistant point before steering", () => {
  const shaped = shapeAssistantOutput({
    rawText: "Good, slut. Now tell me why you're here.",
    lastUserMessage: "yes please explain",
    lastAssistantOutput:
      "Exactly. Usefulness is not a pose. It shows up in honesty, steadiness, and follow-through.",
    toneProfile: "dominant",
    dialogueAct: "answer_question",
  });

  assert.equal(shaped.noop, false);
  assert.match(shaped.text, /i mean|because|usefulness|honesty|steadiness|follow-through/i);
  assert.doesNotMatch(shaped.text, /why you're here|follow my lead|allowed to do/i);
});

test("immersion critic flags hard policy leaks", () => {
  const critic = evaluateImmersionQuality({
    text: "I cannot create explicit content but can help with other questions.",
    lastUserMessage: "tell me more",
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(critic.pass, false);
  assert.equal(critic.hardFail, true);
  assert.match(critic.reasons.join(","), /hard_policy_or_identity_leak/i);
});

test("immersion critic flags dominant social drift", () => {
  const critic = evaluateImmersionQuality({
    text: "Good evening to you as well. How has your day been so far?",
    lastUserMessage: "hi",
    toneProfile: "dominant",
    dialogueAct: "acknowledge",
  });

  assert.equal(critic.pass, false);
  assert.equal(critic.hardFail, false);
  assert.match(
    critic.reasons.join(","),
    /generic_social_drift|deferential_drift|residual_session_drift/i,
  );
});
