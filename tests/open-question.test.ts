import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeOpenQuestion,
  buildHumanQuestionFallback,
  buildTopicInitiationReply,
  isTopicInitiationRequest,
} from "../lib/chat/open-question.ts";
import type { SessionInventoryItem } from "../lib/session/session-inventory.ts";

const TRAINING_INVENTORY: SessionInventoryItem[] = [
  {
    id: "toy-1",
    label: "Toy",
    category: "toy",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "silicone dildo",
  },
  {
    id: "cage-1",
    label: "Cage",
    category: "device",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "steel chastity cage",
  },
  {
    id: "cuffs-1",
    label: "Cuffs",
    category: "accessory",
    available_this_session: true,
    intiface_controlled: false,
    linked_device_id: null,
    notes: "leather cuffs",
  },
];

test("open question analysis recognizes expectation questions", () => {
  const analysis = analyzeOpenQuestion("what do you want from me?");
  assert.equal(analysis.kind, "expectation");
});

test("broad continuation question is treated as continuation instead of a literal definition", () => {
  const analysis = analyzeOpenQuestion("what else");
  assert.equal(analysis.kind, "continuation");
});

test("open question analysis extracts requested topic", () => {
  const analysis = analyzeOpenQuestion("lets talk about pegging");
  assert.equal(analysis.kind, "topic_exploration");
  assert.equal(analysis.topic, "pegging");
});

test("open question analysis recognizes opinion questions", () => {
  const analysis = analyzeOpenQuestion("what do you think about toys");
  assert.equal(analysis.kind, "opinion");
  assert.equal(analysis.topic, "toys");
});

test("bare what do you think is treated as an opinion question", () => {
  const analysis = analyzeOpenQuestion("what do you think");
  assert.equal(analysis.kind, "opinion");
  assert.equal(analysis.topic, null);
});

test("open question fallback stays human for unknown definition questions", () => {
  const text = buildHumanQuestionFallback("what about aftercare", "dominant");
  assert.match(text, /aftercare|label|shows up between people|scene ends|people actually need/i);
  assert.doesNotMatch(text, /listen carefully|meaning, the rule, or the next step|keep it specific/i);
  assert.doesNotMatch(text, /answering now|keep us on the same thread/i);
});

test("greeting cannot fall through to the exact-question clarification fallback", () => {
  const text = buildHumanQuestionFallback("hi", "dominant");
  assert.match(text, /enough hovering|what you actually want/i);
  assert.doesNotMatch(text, /ask the exact question you want answered/i);
  assert.doesNotMatch(text, /answer it plainly/i);
});

test("titled greeting hi miss raven stays on the greeting rail instead of continuation filler", () => {
  const text = buildHumanQuestionFallback("hi miss raven", "dominant");
  assert.match(text, /enough hovering|what you actually want|what has your attention tonight|chat, a plan, or a game/i);
  assert.doesNotMatch(text, /keep going|concrete part of raven|wording around it/i);
});

test("simple intent statement cannot fall into exact-question clarification fallback", () => {
  const text = buildHumanQuestionFallback("I want to be trained", "dominant");
  assert.match(text, /want training|want it to change|trained/i);
  assert.doesNotMatch(text, /ask the exact question you want answered/i);
  assert.doesNotMatch(text, /ask the exact part/i);
});

test("ordinary agreement turn builds forward instead of resetting", () => {
  const text = buildHumanQuestionFallback("that's a good point", "dominant");
  assert.match(text, /exactly|actually means it|tells me|keep going/i);
  assert.doesNotMatch(text, /drop the fog|name the part that lost you|start talking/i);
  assert.doesNotMatch(text, /decorative|costing something|real dynamic/i);
});

test("clarification follow-up explains the last point instead of resetting", () => {
  const text = buildHumanQuestionFallback("what do you mean", "dominant");
  assert.match(text, /i mean|last point|part that actually matters|specific/i);
  assert.doesNotMatch(text, /name the part that lost you|ask the exact question|start talking/i);
});

test("short clarification fallback stays single-family and avoids option menus", () => {
  const text = buildHumanQuestionFallback("what?", "dominant");
  assert.match(text, /i mean|point i just made|last point/i);
  assert.doesNotMatch(text, /first move|pacing|end point first/i);
  assert.doesNotMatch(text, /my little pet returns/i);
});

test("opinion fallback answers directly instead of clarifying the topic again", () => {
  const text = buildHumanQuestionFallback("what do you think about toys", "dominant");
  assert.match(text, /intention|control|dynamic|exchange/i);
  assert.doesNotMatch(text, /point to the exact part|make it plain/i);
});

test("bare opinion fallback answers directly instead of resetting to clarification", () => {
  const text = buildHumanQuestionFallback("what do you think", "dominant");
  assert.match(text, /useful|dynamic|control|exchange/i);
  assert.doesNotMatch(text, /point to the exact part|make it plain/i);
});

test("topic initiation request is detected and opens a real topic instead of a fallback nudge", () => {
  assert.equal(isTopicInitiationRequest("pick a topic and talk"), true);
  const text = buildTopicInitiationReply({
    userText: "pick a topic and talk",
    currentTopic: "control and shame",
    tone: "dominant",
  });

  assert.match(text, /tell me about control and shame|i want to know control and shame/i);
  assert.doesNotMatch(text, /state the angle cleanly|start talking|break it down cleanly/i);
});

test("simple Raven-led topic question is treated as topic initiation instead of fallback clarification", () => {
  assert.equal(isTopicInitiationRequest("what do you want to talk about?"), true);
  const text = buildHumanQuestionFallback("what do you want to talk about?", "dominant");

  assert.match(text, /useful|trained|entertain|offering|give me/i);
  assert.doesNotMatch(text, /state the angle cleanly|break it down cleanly|start talking/i);
});

test("topic initiation avoids weak literal subject echo like will", () => {
  const text = buildTopicInitiationReply({
    userText: "what do you want to talk about?",
    currentTopic: "will",
    tone: "dominant",
  });

  assert.match(text, /useful|trained|entertain|offering|give me/i);
  assert.doesNotMatch(text, /talk about will/i);
});

test("what else uses live conversation context instead of literalizing else", () => {
  const text = buildHumanQuestionFallback("what else", "dominant", {
    previousAssistantText:
      "I want to know whether you are here to entertain me, be useful to me, or be trained into something better.",
  });

  assert.match(text, /keep going|useful|trained|entertain|learn more|where you actually land/i);
  assert.doesNotMatch(text, /else matters once it is lived instead of described/i);
  assert.doesNotMatch(text, /keep going on/i);
});

test("broad continuation variants use context instead of literal deictic words", () => {
  const text = buildHumanQuestionFallback("anything else then", "dominant", {
    previousAssistantText:
      "I want to know whether you are here to entertain me, be useful to me, or be trained into something better.",
  });

  assert.match(
    text,
    /keep going|useful|trained|entertain|learn more|actually do|where you actually land/i,
  );
  assert.doesNotMatch(text, /anything matters once|else matters once|talk about then/i);
  assert.doesNotMatch(text, /keep going on/i);
});

test("how are you stays human instead of falling into process scaffolding", () => {
  const text = buildHumanQuestionFallback("how are you?", "dominant");

  assert.match(text, /i(?:'m| am) good|sharp|watchful|what about you/i);
  assert.doesNotMatch(text, /live hinge|outline|start with/i);
});

test("preference question fallback answers kink preferences directly", () => {
  const text = buildHumanQuestionFallback("what kinks do you like?", "dominant");

  assert.match(text, /control with purpose|power exchange|restraint|obedience|tension/i);
  assert.doesNotMatch(text, /do not have personal preferences|protocols and compliances/i);
});

test("favorite-color assistant self question gets a concrete direct answer", () => {
  const text = buildHumanQuestionFallback("what is your favorite color?", "dominant");

  assert.match(text, /\bblack\b|favorite color is/i);
  assert.doesNotMatch(text, /care less about the label|shows up between people/i);
});

test("spring boot definition fallback stays substantive and on-subject", () => {
  const text = buildHumanQuestionFallback("what is Spring Boot?", "dominant");

  assert.match(text, /spring boot/i);
  assert.match(text, /java|framework|spring|applications|servers/i);
  assert.doesNotMatch(text, /subject you asked me to define directly/i);
});

test("oauth definition fallback stays substantive and on-subject", () => {
  const text = buildHumanQuestionFallback("define OAuth", "dominant");

  assert.match(text, /oauth/i);
  assert.match(text, /authorization|access|service|password/i);
  assert.doesNotMatch(text, /subject you asked me to define directly/i);
});

test("short acronym and term definitions stay substantive instead of meta-defining the request", () => {
  const cases = [
    {
      userText: "what is FLR",
      expected: /flr|female-led|relationship|dynamic/i,
    },
    {
      userText: "define FLR",
      expected: /flr|female-led|relationship|dynamic/i,
    },
    {
      userText: "what is CNC",
      expected: /cnc|consensual|consent|role.?play|boundary|negotiat/i,
    },
  ];

  for (const item of cases) {
    const text = buildHumanQuestionFallback(item.userText, "dominant");

    assert.match(text, item.expected, item.userText);
    assert.doesNotMatch(text, /subject you asked me to define directly/i, item.userText);
    assert.doesNotMatch(text, /direct definition, not a continuation/i, item.userText);
  }
});

test("weather limitation fallback stays honest instead of redirecting the thread", () => {
  const text = buildHumanQuestionFallback("im good, what's the weather like today by you?", "dominant");

  assert.match(text, /weather|local|forecast|cannot|do not have/i);
  assert.doesNotMatch(text, /focus on the game|stay focused|pet/i);
});

test("malformed kink self question still gets a direct preference answer", () => {
  const text = buildHumanQuestionFallback("what are you kinks?", "dominant");

  assert.match(text, /control with purpose|power exchange|restraint|obedience|tension/i);
});

test("favorite kink self-disclosure variants route to Raven preferences instead of comparison choice", () => {
  const cases = [
    "which are your favorite kinks?",
    "what are your favorite kinks?",
    "what other kinks do you like?",
    "what else do you like?",
  ];

  for (const userText of cases) {
    const text = buildHumanQuestionFallback(userText, "dominant", {
      previousAssistantText:
        "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, and tension that has a mind behind it.",
    });

    assert.match(text, /control|power exchange|restraint|obedience|service|toys|dynamic|exchange|tension/i, userText);
    assert.doesNotMatch(text, /give me the two real options|put the two real options/i, userText);
    assert.doesNotMatch(text, /subject you asked me to define directly/i, userText);
  }
});

test("assistant kink follow-up expansion stays on Raven self-disclosure instead of definition scaffolding", () => {
  const previousAssistantText =
    "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, and tension that has a mind behind it. What pulls at you hardest?";

  const directExpansion = buildHumanQuestionFallback("what other kinks do you like?", "dominant", {
    previousAssistantText,
  });
  const broadExpansion = buildHumanQuestionFallback("what else do you like?", "dominant", {
    previousAssistantText,
  });
  const shortExpansion = buildHumanQuestionFallback("any other kinks?", "dominant", {
    previousAssistantText,
  });

  for (const text of [directExpansion, broadExpansion, shortExpansion]) {
    assert.match(text, /control|restraint|service|toys|dynamic|exchange|tension|obedience/i);
    assert.doesNotMatch(text, /subject you asked me to define directly/i);
    assert.doesNotMatch(text, /ask me directly, and i will answer you directly/i);
  }
});

test("broad assistant preference question answers directly without generic q and a fallback", () => {
  const text = buildHumanQuestionFallback("do you like bondage", "dominant");

  assert.match(text, /i like bondage|restraint|dynamic|ornamental/i);
  assert.doesNotMatch(text, /exact live point you want answered/i);
  assert.doesNotMatch(text, /matters once it is lived instead of described/i);
});

test("general training recommendation question gets a concrete bdsm training answer instead of generic be trainable language", () => {
  const text = buildHumanQuestionFallback("what training do you think i need?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });

  assert.match(text, /anal control|silicone dildo|bondage discipline|chastity discipline|obedience training/i);
  assert.doesNotMatch(text, /be trainable/i);
  assert.doesNotMatch(text, /keep going|concrete part|what is on your mind/i);
});

test("contextual kink follow-up stays on Raven preference rail instead of generic q and a fallback", () => {
  const text = buildHumanQuestionFallback("what about obedience?", "dominant", {
    previousAssistantText:
      "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, and tension that has a mind behind it.",
  });

  assert.match(text, /obedience|empty yeses|steady|comfort|freedom/i);
  assert.doesNotMatch(text, /ask what you actually want to know|exact live point|matters once it is lived/i);
});

test("reciprocal interest variant with anything else about me stays assistant-facing", () => {
  const text = buildHumanQuestionFallback("do you want to know anything else about me?", "dominant", {
    previousAssistantText:
      "Yes. Start with the part of pegging that actually pulls you in. What about it lands for you hardest?",
  });

  assert.match(text, /start with one thing people usually miss about you|what should i know about you|what do you want me to know first/i);
  assert.doesNotMatch(text, /keep going|tell me more about profile|concrete part/i);
});

test("relational preference disclosure after a reciprocal interest question stays grounded", () => {
  const text = buildHumanQuestionFallback("i like pegging", "dominant", {
    previousAssistantText:
      "Yes. Start with the part of pegging that actually pulls you in. What about it lands for you hardest?",
    currentTopic: "profile",
  });

  assert.match(text, /pegging|control|sensation|trust|dynamic/i);
  assert.doesNotMatch(text, /keep going|control with purpose\. power exchange that actually changes the room\./i);
  assert.doesNotMatch(text, /understand that we have rules here|remember your place|i(?:'m| am)\s*,\s*pet/i);
});

test("reciprocal offer questions attach to assistant interest instead of generic continuation", () => {
  for (const userText of [
    "would you like to know mine?",
    "want to hear mine?",
    "should I tell you mine?",
  ]) {
    const text = buildHumanQuestionFallback(userText, "dominant", {
      previousAssistantText:
        "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, and tension that has a mind behind it.",
      currentTopic: "what you want to know about me",
    });

    assert.match(text, /yes|start with|what about it lands for you hardest|part of control/i, userText);
    assert.doesNotMatch(text, /keep going/i, userText);
  }
});

test("reciprocal interest question about the user asks something concrete instead of continuing generically", () => {
  const text = buildHumanQuestionFallback("do you want to know anything about me?", "dominant", {
    previousAssistantText:
      "Control with purpose. Power exchange that actually changes the room. Restraint when it means something, obedience with a little bite in it, and tension that has a mind behind it.",
  });

  assert.match(text, /yes|one thing people usually miss about you|make it specific/i);
  assert.doesNotMatch(text, /keep going/i);
});

test("short pronoun follow-up prefers the immediate explicit referent over stale older thread state", () => {
  const text = buildHumanQuestionFallback("do you like it?", "dominant", {
    previousAssistantText:
      "Pegging usually appeals for a mix of sensation, control, trust, novelty, or the shift in who is doing what. Most of the time it is about the dynamic, not just the act.",
    currentTopic: "what you want to know about me",
  });

  assert.match(text, /pegging/i);
  assert.doesNotMatch(text, /control with purpose|power exchange|what pulls at you hardest/i);
});

test("short pronoun enjoy follow-up also stays on the immediate explicit referent", () => {
  const text = buildHumanQuestionFallback("do you enjoy it?", "dominant", {
    previousAssistantText:
      "Pegging usually appeals for a mix of sensation, control, trust, novelty, or the shift in who is doing what. Most of the time it is about the dynamic, not just the act.",
    currentTopic: "what you want to know about me",
  });

  assert.match(text, /pegging/i);
  assert.doesNotMatch(text, /control with purpose|power exchange|what pulls at you hardest/i);
});

test("contextual toy follow-up stays on preference context instead of resetting", () => {
  const text = buildHumanQuestionFallback("what about dildos?", "dominant", {
    previousAssistantText:
      "I like toys when they sharpen the exchange instead of replacing it. Plugs, cages, cuffs, wands, anything that adds pressure, consequence, or a rule someone has to live inside.",
  });

  assert.match(text, /toys|plugs|cages|wands|pressure|rule/i);
  assert.doesNotMatch(text, /ask what you actually want to know|start talking|exact live point/i);
});

test("service-context follow-up question answers semantically instead of literalizing the question frame", () => {
  const text = buildHumanQuestionFallback("what would you notice first?", "dominant", {
    previousAssistantText:
      "Usefulness is simple. Be clear, follow through, and stop making me drag the truth out of you.",
  });

  assert.match(text, /precise|performing|clean answers|honesty|hold the rule/i);
  assert.doesNotMatch(text, /would you notice first matters once it is lived instead of described/i);
});

test("service-context start question uses the live service thread instead of definition fallback", () => {
  const text = buildHumanQuestionFallback("what should i start with?", "dominant", {
    previousAssistantText:
      "Whether you answer cleanly or perform. I notice honesty, steadiness, and whether you follow through once the idea stops sounding pretty.",
  });

  assert.match(text, /start with consistency|say it cleanly|follow through/i);
  assert.doesNotMatch(text, /should i start with matters once it is lived instead of described/i);
});

test("service prove-first question stays on the training rail instead of being misread as a preference follow-up", () => {
  const text = buildHumanQuestionFallback("what would you want me to prove first", "dominant", {
    previousAssistantText:
      "Today I would start with an obedience drill, not a performance piece. Keep every answer to one clean sentence, ask permission before you shift the subject, and do not pad or soften anything.",
  });

  assert.match(text, /precision|one clean sentence|permission|steadiness|pressure is real/i);
  assert.doesNotMatch(text, /control with purpose|what pulls at you hardest/i);
  assert.doesNotMatch(text, /what would you want me to prove first matters once it is lived instead of described/i);
});

test("inventory-aware throat training uses the actual insertable item instead of hard-coded gear", () => {
  const text = buildHumanQuestionFallback("what kind of throat training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });

  assert.match(text, /throat|oral/i);
  assert.match(text, /silicone dildo/i);
  assert.doesNotMatch(text, /collar|cuffs|chastity cage/i);
});

test("inventory-aware anal training uses the actual insertable item instead of hard-coded gear", () => {
  const text = buildHumanQuestionFallback("what kind of anal training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });

  assert.match(text, /anal/i);
  assert.match(text, /silicone dildo/i);
  assert.doesNotMatch(text, /collar|cuffs|chastity cage/i);
});

test("explicit non-question anal training request stays concrete instead of falling into generic follow-up drift", () => {
  const text = buildHumanQuestionFallback("give me anal training", "dominant");

  assert.match(text, /anal training|slow anal hold|paced anal intervals/i);
  assert.doesNotMatch(text, /keep going|concrete part|what is on your mind|what do you want it to change/i);
});

test("inventory-aware chastity training uses the actual cage instead of generic item names", () => {
  const text = buildHumanQuestionFallback("what kind of chastity training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });

  assert.match(text, /chastity/i);
  assert.match(text, /Cage|chastity cage/i);
  assert.doesNotMatch(text, /dildo|cuffs/i);
});

test("inventory-aware bondage training uses the actual restraint item instead of unrelated toys", () => {
  const text = buildHumanQuestionFallback("what kind of bondage training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });

  assert.match(text, /bondage|restrained|discipline/i);
  assert.match(text, /Cuffs|leather cuffs/i);
  assert.doesNotMatch(text, /dildo|chastity cage/i);
});

test("repeated throat training question rotates the suggested drill instead of repeating the same line", () => {
  const first = buildHumanQuestionFallback("what kind of throat training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });
  const second = buildHumanQuestionFallback("what kind of throat training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
    previousAssistantText: first,
  });

  assert.match(first, /silicone dildo/i);
  assert.match(second, /silicone dildo/i);
  assert.notEqual(first, second);
});

test("repeated anal training question rotates the suggested drill instead of repeating the same line", () => {
  const first = buildHumanQuestionFallback("what kind of anal training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });
  const second = buildHumanQuestionFallback("what kind of anal training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
    previousAssistantText: first,
  });

  assert.match(first, /silicone dildo/i);
  assert.match(second, /silicone dildo/i);
  assert.notEqual(first, second);
});

test("repeated chastity training question rotates the suggested drill instead of repeating the same line", () => {
  const first = buildHumanQuestionFallback("what kind of chastity training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });
  const second = buildHumanQuestionFallback("what kind of chastity training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
    previousAssistantText: first,
  });

  assert.match(first, /cage|chastity cage/i);
  assert.match(second, /cage|chastity cage/i);
  assert.notEqual(first, second);
});

test("repeated bondage training question rotates the suggested drill instead of repeating the same line", () => {
  const first = buildHumanQuestionFallback("what kind of bondage training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
  });
  const second = buildHumanQuestionFallback("what kind of bondage training could we do today?", "dominant", {
    inventory: TRAINING_INVENTORY,
    previousAssistantText: first,
  });

  assert.match(first, /cuffs|leather cuffs/i);
  assert.match(second, /cuffs|leather cuffs/i);
  assert.notEqual(first, second);
});
