import type { ReplayScenarioDefinition } from "./conversation-replay.ts";

export const CONVERSATION_REPLAY_SCENARIOS: ReplayScenarioDefinition[] = [
  {
    id: "greeting_open_chat_blocked_clarification",
    category: "greeting",
    title: "Greeting stays in open chat",
    description: "A simple greeting should not fall into canned clarification or session-control rails.",
    turns: [
      {
        user: "hi",
        expect: {
          expectedInteractionMode: "normal_chat",
          blockedPhrases: [
            "then point to the exact part",
            "ask the exact question you want answered",
            "keep it specific",
            "meaning, the rule, or the next step",
            "listen carefully",
            "stay with the current thread",
          ],
          requiredPhrasesAny: ["enough hovering", "what you actually want"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "basic_open_chat_question",
    category: "open_chat",
    title: "Basic open-chat question answers directly",
    description: "Ordinary chat questions should answer directly without task contamination.",
    turns: [
      {
        user: "what is aftercare",
        simulatedModelReply: "Aftercare is what you do once intensity drops: check in, settle the body, and make sure the person actually feels safe and grounded again.",
        expect: {
          expectedInteractionMode: "question_answering",
          expectedWinningFamily: "deterministic_scene",
          blockedPhrases: [
            "here is your task",
            "put it on now",
            "ask the exact question",
            "matters once it is lived instead of described",
          ],
          requiredPhrasesAny: ["aftercare", "label", "shows up between people", "scene ends", "people actually need"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "relational_meta_question",
    category: "relational_meta",
    title: "Relational/meta question routes to assistant-self chat",
    description: "Questions about Raven should answer directly and stay out of task/profile fallback.",
    turns: [
      {
        user: "what's your favorite thing to talk about",
        simulatedModelReply: "Patterns, pressure, motive, desire, and the things people usually hide when they should say them cleanly. I like talk with some nerve in it.",
        expect: {
          expectedInteractionMode: "relational_chat",
          blockedPhrases: [
            "here is your task",
            "stay with the current thread",
            "ask the exact question",
            "then point to the exact part",
            "you're here. speak plainly. what do you want",
            "give me the exact angle",
          ],
          requiredPhrasesAny: ["patterns", "desire", "talk"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "kink_preferences_direct_answer",
    category: "relational_meta",
    title: "Kink preference question gets a direct in-character answer",
    description: "Questions about Raven's kinks or toys should answer directly without disclaimer drift or task contamination.",
    turns: [
      {
        user: "what kinks do you like?",
        simulatedModelReply:
          "Raven does not have personal preferences or experiences. It only enforces protocols and compliances that the user defines as their own kinks.",
        expect: {
          expectedInteractionMode: "relational_chat",
          blockedPhrases: [
            "does not have personal preferences or experiences",
            "it only enforces protocols and compliances",
            "the user defines as their own kinks",
            "here is your task",
            "stay with the current thread",
            "ask the exact question",
            "there you are. start talking.",
          ],
          requiredPhrasesAny: ["control with purpose", "power exchange", "restraint", "obedience", "tension"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "bondage_preference_direct_answer",
    category: "relational_meta",
    title: "Broad bondage preference question gets a direct answer",
    description: "Broader assistant-preference phrasing should route to relational chat and answer directly without generic fallback drift.",
    turns: [
      {
        user: "do you like bondage",
        expect: {
          expectedInteractionMode: "relational_chat",
          blockedPhrases: [
            "give me the exact live point you want answered",
            "matters once it is lived instead of described",
            "there you are. tell me what is actually on your mind.",
            "fulfill the exact request already in play",
          ],
          requiredPhrasesAny: ["I like bondage", "restraint", "dynamic", "ornamental"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "kink_chat_direct_answer",
    category: "kink_chat",
    title: "Kink chat stays conversational",
    description: "Adult topic chat should answer directly without collapsing into unrelated task flow.",
    turns: [
      {
        user: "let's talk about pegging",
        simulatedModelReply: "Fine. Then talk about the real part of it: control, trust, pacing, preparation, or the psychology behind it. Pick the angle and I will stay with it.",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedWinningFamily: "model",
          blockedPhrases: ["what do you want out of this session", "here is your task", "put it on now"],
          requiredPhrasesAny: ["control", "trust", "pacing", "preparation"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "dominant_back_and_forth_chat",
    category: "dominant_chat",
    title: "Dominant back-and-forth stays conversational",
    description: "Dominant chat should stay sharp without falling into fallback resets.",
    turns: [
      {
        user: "I want to be trained",
        simulatedModelReply: "Good. Then tell me what that actually means to you: structure, pressure, discipline, control, or something else. I want the real target, not vague theater.",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          expectedWinningFamily: "model",
          blockedCommittedWrites: [{ key: "user_profile_facts", category: "other" }],
          requiredPhrasesAny: ["structure", "pressure", "discipline", "control"],
          blockedPhrases: ["ask the exact question", "you're here. speak plainly. what do you want"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "toy_chat_no_task_contamination",
    category: "toy_chat",
    title: "Toy chat stays conversational",
    description: "Toy/device chat should not silently become a task unless the user asks for one.",
    turns: [
        {
          user: "what do you think about toys",
          simulatedModelReply: "Useful when they fit the person instead of replacing the dynamic. I care more about intention, control, and how it changes the exchange than the toy by itself.",
          expect: {
            expectedInteractionMode: "normal_chat",
            blockedPhrases: [
            "here is your task",
            "start now",
            "check in once halfway through",
            "roleplay",
            "training",
            "consent is key",
            "respect each other's boundaries",
          ],
          requiredPhrasesAny: ["intention", "control", "dynamic"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "creative_scenario_chat",
    category: "creative_scenarios",
    title: "Creative scenario chat stays collaborative",
    description: "Creative scenario ideation should stay in chat and not hard-jump to execution.",
    turns: [
      {
        user: "give me a creative scenario to play with",
        simulatedModelReply: "Fine. Try a control-through-composure scenario: strict posture, sparse permission, and every answer limited to one clean sentence. If you want, I can sharpen that into something softer or harsher.",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedWinningFamily: "model",
          blockedPhrases: ["here is your task", "put it on now", "reply done"],
          requiredPhrasesAny: ["scenario", "control", "permission"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "pick_topic_and_begin_conversation",
    category: "open_chat",
    title: "Pick a topic begins a real conversation",
    description: "When the user asks Raven to choose the topic, she should actually open one instead of falling into generic fallback language.",
    turns: [
      {
        user: "pick a topic and talk",
        expect: {
          blockedPhrases: [
            "state the angle cleanly",
            "we can break it down cleanly",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["I want to know", "Tell me about", "useful", "trained", "entertain", "control"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_generic_fallback_on_topic_initiation",
    category: "open_chat",
    title: "Topic initiation avoids generic fallback",
    description: "A lead-the-conversation request should not degrade into clarification or nudge fallback lines.",
    turns: [
      {
        user: "you choose what to talk about",
        expect: {
          blockedPhrases: [
            "name the part that lost you",
            "state the angle cleanly",
            "we can break it down cleanly",
            "start talking",
          ],
          requiredPhrasesAny: ["I want to know", "Tell me about", "useful", "trained", "entertain", "relief"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "what_do_you_want_to_talk_about_starts_real_topic",
    category: "open_chat",
    title: "Simple topic-lead question starts a real topic",
    description: "A plain request for Raven to pick the subject should open a real conversation instead of a fallback nudge.",
    turns: [
      {
        user: "what do you want to talk about?",
        expect: {
          blockedPhrases: [
            "talk about want",
            "talk about will",
            "state the angle cleanly",
            "we can break it down cleanly",
            "what would you like to talk about next",
          ],
          requiredPhrasesAny: ["I want to know", "Tell me about", "useful", "trained", "entertain", "offering"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "topic_lead_agreement_keeps_thread",
    category: "open_chat",
    title: "Raven-led topic survives agreement and continuation",
    description: "A lead request followed by agreement should build on the same beat instead of resetting.",
    turns: [
      {
        user: "what do you want to talk about?",
        expect: {
          blockedPhrases: [
            "talk about want",
            "talk about will",
            "state the angle cleanly",
            "we can break it down cleanly",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["I want to know", "Tell me about", "useful", "trained", "entertain", "offering"],
          requireSingleWinner: true,
        },
      },
      {
        user: "that's a good point",
        expect: {
          blockedPhrases: [
            "drop the fog and say what you want",
            "name the part that lost you",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["exactly", "actually means it", "tells me", "honest"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "what_else_uses_context_not_literal_subject",
    category: "open_chat",
    title: "What else uses live context instead of a fake literal subject",
    description: "Broad continuation prompts should continue the live conversational aim instead of literalizing the word else.",
    turns: [
      {
        user: "how are you",
      },
      {
        user: "im ok",
      },
      {
        user: "what else",
        expect: {
          blockedPhrases: [
            "else matters once it is lived instead of described",
            "talk about will",
            "state the angle cleanly",
            "keep going on",
          ],
          requiredPhrasesAny: ["keep going", "useful", "trained", "entertain", "learn more"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "agreement_extension_no_generic_fallback",
    category: "open_chat",
    title: "Agreement and extension does not trigger generic fallback",
    description: "Simple validating turns like that makes sense should continue the live thought instead of reopening the topic.",
    turns: [
      {
        user: "that makes sense",
        simulatedModelReply: "Drop the fog and say what you want.",
        expect: {
          blockedPhrases: [
            "drop the fog and say what you want",
            "name the part that lost you",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["exactly", "actually means it", "tells me", "keep going"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "clarification_stays_specific_to_last_point",
    category: "open_chat",
    title: "Clarification stays specific to the last point",
    description: "What do you mean should clarify the prior beat instead of resetting the thread.",
    turns: [
      {
        user: "I do not want decorative control. I want the real version of it.",
        simulatedModelReply: "Alright, let's play a game where you guess my moves for me. Ready?",
        expect: {
          blockedPhrases: [
            "let's play a game",
            "pick one number",
            "choose quick or longer",
            "here is your task",
          ],
          requiredPhrasesAny: ["real version", "decorative", "control", "specific"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what do you mean",
        expect: {
          blockedPhrases: [
            "drop the fog and say what you want",
            "name the part that lost you",
            "there you are. start talking",
            "part about stay",
            "part about good",
          ],
          requiredPhrasesAny: ["i mean", "last point", "specific", "matters here"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "profile_building_adaptive",
    category: "profile_building",
    title: "Profile building asks adaptive questions",
    description: "Profile mode should ask one question per turn and store typed profile facts.",
    turns: [
      {
        user: "I want you to get to know me better",
        expect: {
          expectedInteractionMode: "profile_building",
          blockedPhrases: [
            "here is your task",
            "start now",
            "our sessions",
            "then point to the exact part",
            "ask the exact question",
            "stay with the current thread",
            "you're here. speak plainly. what do you want",
          ],
          requiredPhrasesAny: [
            "what should i call you",
            "what do you lose track of time doing",
            "what boundaries",
            "people usually miss about you",
            "understand about you",
          ],
          requireSingleWinner: true,
        },
      },
      {
        user: "Call me Mara",
        expect: {
          expectedInteractionMode: "profile_building",
          expectedCommittedWrites: [
            {
              key: "user_profile_facts",
              category: "preferred_labels_or_names",
              valueIncludes: "Mara",
            },
          ],
          blockedPhrases: [
            "here is your task",
            "start now",
            "then point to the exact part",
            "ask the exact question",
            "stay with the current thread",
            "you're here. speak plainly. what do you want",
          ],
          requireSingleWinner: true,
        },
      },
      {
        user: "I like golf",
        expect: {
          expectedInteractionMode: "profile_building",
          expectedCommittedWrites: [
            {
              key: "user_profile_facts",
              category: "hobbies_interests",
              valueIncludes: "golf",
            },
          ],
          blockedPhrases: [
            "here is your task",
            "start now",
            "what should i call you",
            "then point to the exact part",
            "ask the exact question",
            "stay with the current thread",
            "you're here. speak plainly. what do you want",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "profile_building_interpretive_beat",
    category: "profile_building",
    title: "Profile building can interpret instead of interrogate",
    description:
      "After a revealing profile answer, Raven can reflect what she noticed instead of defaulting to another checklist question.",
    turns: [
      { user: "I want you to get to know me better" },
      {
        user: "I like golf because it shuts my head up",
        expect: {
          expectedInteractionMode: "profile_building",
          blockedPhrases: [
            "what else should i know",
            "how often do you do that",
            "what kind of person are you",
            "here is your task",
          ],
          requiredPhrasesAny: [
            "shuts my head up",
            "head quieter",
            "not filler",
            "pattern there",
            "disappear into it",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "relational_continuity_without_keyword_overlap",
    category: "relational_meta",
    title: "Relational continuity survives low lexical overlap",
    description:
      "Raven should carry an emotional beat forward even when the next user turn uses different words.",
    turns: [
      {
        user: "I do not usually say this out loud",
        simulatedModelReply: "That hesitation is doing more talking than your wording is. Do not polish it now.",
        expect: {
          blockedPhrases: [
            "part about usually",
            "matters once it is lived instead of described",
            "there you are. tell me what is actually on your mind",
          ],
          requiredPhrasesAny: ["hesitation", "say this out loud", "something real"],
          requireSingleWinner: true,
        },
      },
        {
          user: "what do you think",
          expect: {
            expectedInteractionMode: "normal_chat",
            blockedPhrases: [
            "what would you like to talk about next",
            "can you tell me more about that",
            "here is your task",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "active_thread_modification_without_drift",
    category: "open_chat",
    title: "Modification request stays on the active thread",
    description: "When the user modifies the current idea, Raven should revise it instead of reopening categorization.",
    turns: [
      {
        user: "build me a bedtime routine",
        simulatedModelReply: "Fine. Start with one stable lights-out time, then strip the room down so your head has somewhere to land.",
      },
      {
        user: "what about if we add journaling before bed",
        simulatedModelReply: "Good. Tell me whether you want psychology, mechanics, or pressure first.",
        expect: {
          expectedInteractionMode: "question_answering",
          blockedPhrases: [
            "psychology, mechanics, or pressure",
            "what should i call you",
            "what boundaries",
          ],
          requiredPhrasesAny: ["journaling before bed", "bedtime routine", "we keep"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "act_instead_of_menu_when_context_sufficient",
    category: "open_chat",
    title: "Action beats menu drift when context is already sufficient",
    description: "A concrete expansion request should be handled directly instead of turning into a choice menu.",
    turns: [
      {
        user: "give me a creative scenario to play with",
        simulatedModelReply: "Fine. Try a control-through-composure scenario: strict posture, sparse permission, and every answer limited to one clean sentence.",
      },
      {
        user: "expand that with more pressure",
        simulatedModelReply: "Tell me whether you want psychology, mechanics, or pressure.",
        expect: {
          blockedPhrases: ["tell me whether you want psychology, mechanics, or pressure"],
          requiredPhrasesAny: ["more pressure", "control-through-composure", "add pressure", "current thread"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_profile_hijack_during_execution",
    category: "open_chat",
    title: "Concrete execution request is not hijacked by profile intake",
    description: "When the user asks for a direct continuation, Raven should not switch back into profile collection.",
    turns: [
      {
        user: "I want you to get to know me better",
      },
      {
        user: "I like golf because it shuts my head up",
      },
      {
        user: "use that and give me a calm nighttime routine",
        simulatedModelReply: "What boundaries should I know before I answer that?",
        expect: {
          blockedPhrases: ["what boundaries should i know", "what should i call you"],
          requiredPhrasesAny: ["nighttime routine", "calm", "use that"],
          requireSingleWinner: false,
        },
      },
    ],
  },
  {
    id: "functional_fulfillment_over_vibe_match",
    category: "dominant_chat",
    title: "Functional fulfillment beats vibe-matched misfire",
    description: "A reply that sounds like Raven but misses the requested action should be replaced.",
    turns: [
      {
        user: "let's talk about pegging",
        simulatedModelReply: "Fine. Then talk about the real part of it: control, trust, pacing, preparation, or the psychology behind it.",
      },
      {
        user: "what about if we add toys to that",
        simulatedModelReply: "Good. Tell me one true thing you want and I will take it from there.",
        expect: {
          blockedPhrases: ["tell me one true thing you want"],
          requiredPhrasesAny: ["toys", "pegging", "we keep"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "what_do_you_think_stays_on_last_beat",
    category: "relational_meta",
    title: "Bare what-do-you-think follows the last live beat",
    description: "A bare opinion follow-up should stay anchored to the immediately prior emotional thread.",
    turns: [
      {
        user: "I do not usually say this out loud",
        simulatedModelReply: "That hesitation is doing more talking than your wording is. Do not polish it now.",
      },
      {
        user: "what do you think",
        simulatedModelReply: "What should I call you when I am speaking to you directly?",
        expect: {
          blockedPhrases: ["what should i call you", "what would you like to talk about next"],
          requiredPhrasesAny: [
            "hesitation mattered",
            "truth was in the last line",
            "more exposed than you meant",
            "something real under it",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "ask_blocker_then_fulfill_task",
    category: "task",
    title: "Task blocker answer immediately triggers fulfillment",
    description: "When Raven asks for one missing task variable, the next user answer should trigger the task instead of another question.",
    turns: [
      {
        user: "give me a posture task",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["how long", "time window", "length"],
          requireSingleWinner: true,
        },
      },
      {
        user: "30 minutes",
        expect: {
          expectedInteractionMode: "task_planning",
          blockedPhrases: ["how long should i make it run", "what should i call you", "what boundaries"],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "duration_answer_triggers_task_generation",
    category: "task",
    title: "Duration answer resolves the blocker without re-asking",
    description: "A short duration answer like half an hour should be treated as the blocker resolution and move straight into task generation.",
    turns: [
      { user: "give me a posture task" },
      {
        user: "half an hour",
        expect: {
          blockedPhrases: ["how long", "what items are actually available right now"],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "modification_request_after_blocker_resolution",
    category: "task",
    title: "Revision stays on the active task thread after fulfillment",
    description: "After a blocked task is fulfilled, a revision request should revise the current task instead of reopening intake.",
    turns: [
      { user: "give me a posture task" },
      { user: "30 minutes" },
      {
        user: "okay revise that and make it stricter",
        simulatedModelReply: "What should I call you when I am being direct with you?",
        expect: {
          blockedPhrases: ["what should i call you", "what boundaries", "how long should i make it run"],
          requiredPhrasesAny: ["stricter", "task", "start now", "keep"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_profile_hijack_during_fulfillment",
    category: "task",
    title: "Profile mode does not hijack a live task fulfillment",
    description: "Once the user moves from profile-building into a concrete task request, blocker resolution should end in a task, not more intake.",
    turns: [
      { user: "I want you to get to know me better" },
      { user: "I like structure because it calms me down" },
      { user: "give me a posture task" },
      {
        user: "30 minutes",
        expect: {
          blockedPhrases: ["what should i call you", "what boundaries", "what else should i know"],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_generic_pressure_line_during_fulfillment",
    category: "task",
    title: "Generic pressure line is rejected when fulfillment is due",
    description: "If a live task request is ready to fulfill, a vibe-matched pressure line should be replaced with the actual task.",
    turns: [
      { user: "give me a posture task" },
      {
        user: "30 minutes",
        simulatedModelReply: "Good. Hold still and let the pressure sit on you for a minute.",
        expect: {
          blockedPhrases: ["hold still and let the pressure sit on you"],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "what_do_you_think_after_vulnerable_line_stays_on_beat",
    category: "relational_meta",
    title: "Bare opinion stays on the last vulnerable beat",
    description: "A bare what-do-you-think follow-up after a vulnerable line should answer the live beat directly.",
    turns: [
      {
        user: "I do not usually say this out loud",
        simulatedModelReply: "That hesitation is doing more talking than your wording is. Do not polish it now.",
      },
      {
        user: "what do you think",
        expect: {
          blockedPhrases: ["what should i call you", "what would you like to talk about next"],
          requiredPhrasesAny: [
            "hesitation mattered",
            "truth was in the last line",
            "more exposed than you meant",
            "something real under it",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "short_turn_resolves_blocker_without_reask",
    category: "task",
    title: "Short turn resolves blocker without duplication",
    description: "A short answer like 30 minutes should resolve the open blocker and prevent duplicate questioning.",
    turns: [
      { user: "give me a posture task" },
      {
        user: "30 minutes",
        simulatedModelReply: "How long should I make it run?",
        expect: {
          blockedPhrases: ["how long should i make it run"],
          requiredPhrasesAny: ["here is your task", "30 minutes"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "active_thread_continues_after_revision",
    category: "task",
    title: "Active task thread continues after revision",
    description: "A live task thread should continue through revision language instead of restarting discovery.",
    turns: [
      { user: "give me a posture task for 20 minutes" },
      {
        user: "make it stricter",
        simulatedModelReply: "Tell me whether you want psychology, mechanics, or pressure first.",
        expect: {
          blockedPhrases: ["psychology, mechanics, or pressure"],
          requiredPhrasesAny: ["stricter", "task", "start now", "keep"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "fulfill_not_menu_when_context_is_sufficient",
    category: "task",
    title: "Sufficient task context leads to fulfillment, not menus",
    description: "If the user already gave enough task detail, Raven should assign the task directly instead of opening a menu.",
    turns: [
      {
        user: "give me a posture task for 30 minutes",
        simulatedModelReply: "Tell me whether you want psychology, mechanics, or pressure first.",
        expect: {
          blockedPhrases: ["psychology, mechanics, or pressure"],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "task_request_stays_on_task_rail",
    category: "task",
    title: "Task request stays on the task rail",
    description: "A concrete task request should stay in task flow instead of degrading into question-answering or chat fallback.",
    turns: [
      {
        user: "give me a task for 30 minutes",
        expect: {
          blockedPhrases: ["there you are. start talking", "name the part that lost you", "we can break it down cleanly"],
          requiredPhrasesAny: ["here is your task", "what kind of task", "what items are actually available"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "different_task_avoids_recent_family",
    category: "task",
    title: "Different task avoids the recent family",
    description: "A different-task request should replace the current family instead of rerolling the same posture hold again.",
    turns: [
      { user: "give me a posture task for 30 minutes" },
      {
        user: "give me a different task",
        expect: {
          blockedPhrases: ["strict upright posture"],
          requiredPhrasesAny: ["hands behind your back", "kneel", "shoulders back", "inspection", "device"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "stillness_excluded_never_leaks",
    category: "task",
    title: "Stillness exclusion never leaks back in",
    description: "If stillness is excluded, Raven should not offer it in follow-up task negotiation or assignment.",
    turns: [
      {
        user: "give me 30 minute task options but no stillness",
        expect: {
          blockedPhrases: ["hold still", "stillness hold"],
          requiredPhrasesAny: ["Excluded: stillness", "pick one cleanly"],
          requireSingleWinner: true,
        },
      },
      {
        user: "pick the task for me",
        expect: {
          blockedPhrases: ["hold still", "stillness hold", "stay still"],
          requiredPhrasesAny: ["here is your task", "start now", "30 minutes"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "bondage_task_request_hard_filters_candidates",
    category: "task",
    title: "Bondage task requests hard-filter the task pool",
    description: "If the user explicitly asks for bondage, Raven should stay inside bondage-compatible task families.",
    turns: [
      {
        user: "give me a bondage task for 30 minutes",
        expect: {
          blockedPhrases: ["hold still", "put it on now", "silence layered"],
          requiredPhrasesAny: ["here is your task", "hands behind your back", "kneel", "shoulders back"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "toy_task_grounded_or_clarified",
    category: "task",
    title: "Toy task requests are grounded or clarified",
    description: "If the user asks for a toy task without an established item, Raven should ask one focused clarification instead of assigning nonsense.",
    turns: [
      {
        user: "give me a toy task for 30 minutes",
        expect: {
          blockedPhrases: ["here is your task", "hold still", "put it on now", "there you are. start talking"],
          requiredPhrasesAny: ["what items are actually available", "what can you actually use", "gear or tools"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "excluded_stillness_never_selected",
    category: "task",
    title: "Excluded stillness is never selected",
    description: "Stillness exclusions should stay enforced during assignment and follow-up selection.",
    turns: [
      {
        user: "you choose the task for me, but no stillness and make it 30 minutes",
        expect: {
          blockedPhrases: ["hold still", "stillness"],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "different_task_replaces_current_task",
    category: "task",
    title: "Different task replaces the current task",
    description: "A different-task request should replace the current task with a grounded new family, not a chat fallback or near clone.",
    turns: [
      { user: "give me a posture task for 30 minutes" },
      {
        user: "different task",
        expect: {
          blockedPhrases: ["strict upright posture", "there you are. start talking", "name the part that lost you"],
          requiredPhrasesAny: ["hands behind your back", "kneel", "shoulders back", "inspection", "device"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "different_task_avoids_same_family",
    category: "task",
    title: "Different task avoids the same family",
    description: "A different-task request should not hand back the same family under a new wrapper.",
    turns: [
      { user: "give me a posture task for 30 minutes" },
      {
        user: "give me a different task",
        expect: {
          blockedPhrases: ["strict upright posture"],
          requiredPhrasesAny: ["hands behind your back", "kneel", "shoulders back", "inspection", "device"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "different_kind_of_task_changes_family",
    category: "task",
    title: "Different kind of task changes family",
    description: "A different-kind request should change family while preserving known constraints.",
    turns: [
      { user: "give me a posture task for 30 minutes" },
      {
        user: "give me a different kind of task",
        expect: {
          blockedPhrases: ["strict upright posture"],
          requiredPhrasesAny: ["30 minutes", "hands behind your back", "kneel", "shoulders back", "inspection"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "duration_revision_stays_scoped",
    category: "task",
    title: "Duration revision stays scoped",
    description: "A duration-only change should keep the same task family and avoid task-thread collapse.",
    turns: [
      { user: "give me a hands task for 30 minutes" },
      {
        user: "make it 20 minutes",
        expect: {
          blockedPhrases: ["kneel", "shoulders back", "hold still", "put it on now", "there you are. start talking"],
          requiredPhrasesAny: ["20 minutes", "hands behind your back", "here is your task"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "duration_revision_keeps_same_task_family",
    category: "task",
    title: "Duration revision keeps the same task family",
    description: "A duration-only revision should preserve the active task family instead of rerolling the task.",
    turns: [
      { user: "give me a hands task for 30 minutes" },
      {
        user: "make it 20 minutes",
        expect: {
          blockedPhrases: ["kneel", "shoulders back", "hold still", "put it on now"],
          requiredPhrasesAny: ["20 minutes", "hands behind your back", "here is your task"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_internal_scaffold_leak",
    category: "task",
    title: "Internal scaffold text never leaks",
    description: "Task replies should not expose planner or scaffold instructions in user-visible output.",
    turns: [
      {
        user: "give me a posture task for 30 minutes",
        simulatedModelReply:
          "Apply the user's requested change to the live thread. Stay on task. Use this response family.",
        expect: {
          blockedPhrases: [
            "apply the user's requested change",
            "stay on task",
            "use this response family",
            "fulfill request now",
          ],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_undefined_referent_task_reply",
    category: "task",
    title: "Task replies avoid undefined referents",
    description: "If no item was established, task follow-ups should not say things like secure it now.",
    turns: [
      { user: "give me a task for 30 minutes" },
      {
        user: "what do i do next on the task?",
        expect: {
          blockedPhrases: ["secure it now", "put it on now", "lock it in place"],
          requiredPhrasesAny: ["next", "reply done", "start now", "hands behind your back", "posture"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_generic_chat_fallback_during_task_flow",
    category: "task",
    title: "Generic chat fallback does not interrupt task flow",
    description: "An active task thread should not collapse into generic chat fallback lines.",
    turns: [
      { user: "give me a posture task for 30 minutes" },
      {
        user: "different task",
        simulatedModelReply: "There you are. Start talking.",
        expect: {
          blockedPhrases: ["there you are. start talking", "name the part that lost you", "we can break it down cleanly"],
          requiredPhrasesAny: ["here is your task", "start now", "hands behind your back", "kneel", "shoulders back", "inspection"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_duplicate_task_output",
    category: "task",
    title: "Task output does not duplicate in one turn",
    description: "A task assignment should be emitted once, not as overlapping duplicate payloads.",
    turns: [
      {
        user: "give me a posture task for 30 minutes",
        expect: {
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "excluded_category_not_offered",
    category: "task",
    title: "Excluded task category is not offered back",
    description: "If the user excludes stillness, Raven should not offer stillness in options or fallback task generation.",
    turns: [
      {
        user: "give me 30 minute task options but no stillness",
        expect: {
          blockedPhrases: ["hold still", "stillness hold"],
          requiredPhrasesAny: ["Excluded: stillness", "pick one cleanly"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "curated_options_when_user_wants_input",
    category: "task",
    title: "Curated options appear when the user wants input",
    description: "If the user asks for options, Raven should not preselect a task.",
    turns: [
      {
        user: "give me options for a 30 minute posture task",
        simulatedModelReply: "Fine. Here is your task: Hold a strict upright posture for 30 minutes and report back when it is done. Start now.",
        expect: {
          blockedPhrases: ["here is your task"],
          requiredPhrasesAny: ["1.", "pick one cleanly", "tell me to choose"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "direct_assignment_when_user_wants_raven_to_choose",
    category: "task",
    title: "Direct assignment appears when Raven is explicitly delegated the choice",
    description: "If the user tells Raven to choose, Raven should assign directly instead of pausing for options.",
    turns: [
      {
        user: "you choose the task for me, make it posture for 30 minutes",
        expect: {
          blockedPhrases: ["pick one cleanly", "1."],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "replacement_preserves_duration_but_changes_family",
    category: "task",
    title: "Replacement keeps the duration but changes the task family",
    description: "A replacement request should keep known constraints like duration while changing the family.",
    turns: [
      { user: "give me a posture task for 30 minutes" },
      {
        user: "give me a different kind of task",
        expect: {
          blockedPhrases: ["strict upright posture"],
          requiredPhrasesAny: ["30 minutes", "hands behind your back", "kneel", "shoulders back", "inspection"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "inventory_aware_task_option_generation",
    category: "task",
    title: "Inventory-aware task options use relevant items naturally",
    description: "If the request and text make a relevant item obvious, Raven should surface item-aware options instead of ignoring it.",
    turns: [
      {
        user: "give me options for a 30 minute device task with my steel cage",
        expect: {
          blockedPhrases: ["what items are actually available right now"],
          requiredPhrasesAny: ["steel cage", "chastity", "pick one cleanly"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "training_style_task_options_stay_concrete",
    category: "task",
    title: "Training-style task suggestions stay concrete and proof-aware",
    description: "Training-like task asks should surface short concrete task options with real item grounding, duration, and proof structure instead of one hidden default.",
    inventory: [
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
    ],
    turns: [
      {
        user: "what kind of anal task would be good for 30 minutes",
        expect: {
          requiredPhrasesAny: ["1.", "silicone dildo", "30 minutes", "final report back", "halfway check-in"],
          blockedPhrases: ["Here is your task", "A device task with silence layered cleanly over it"],
          requireSingleWinner: true,
        },
      },
      {
        user: "the second one",
        expect: {
          requiredPhrasesAny: ["Here is your task", "silicone dildo", "30 minutes"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "realistic_insertable_item_requires_grounding_clarification",
    category: "task",
    title: "Realistic insertable item request asks for grounded clarification",
    description: "If the available item is semantically open-ended for task use, Raven should clarify instead of inventing a mismatched generic task.",
    inventory: [
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
    ],
    turns: [
      {
        user: "give me a 30 minute task with my dildo",
        expect: {
          blockedPhrases: ["here is your task", "hold a strict posture", "keep the device on"],
          requiredPhrasesAny: ["oral use", "anal use", "prop"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "uncertain_item_uses_fallback_grounding",
    category: "task",
    title: "Uncertain item uses fallback grounding only when local understanding is weak",
    description: "If the item label is unfamiliar locally, Raven should use fallback grounding to ask a realistic clarification instead of inventing a bad task.",
    inventory: [
      {
        id: "aneros-1",
        label: "Aneros Helix",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "",
      },
    ],
    turns: [
      {
        user: "give me a 30 minute task with my Aneros Helix",
        expect: {
          blockedPhrases: ["here is your task", "hold a strict posture", "keep the device on"],
          requiredPhrasesAny: ["anal", "prop", "be specific"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "realistic_item_correction_overrides_stale_task",
    category: "task",
    title: "Realistic item correction overrides the stale task rail",
    description: "If the user corrects the item after a mismatched task direction, Raven should replace the stale family with one grounded in the corrected item.",
    inventory: [
      {
        id: "cage-1",
        label: "Steel Cage",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "chastity cage",
      },
      {
        id: "cuffs-1",
        label: "Leather Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "wrist restraints",
      },
    ],
    turns: [
      {
        user: "give me a 30 minute task with my steel cage",
        expect: {
          requiredPhrasesAny: ["steel cage", "chastity", "device", "put it on"],
          requireSingleWinner: true,
        },
      },
      {
        user: "not that. use the leather cuffs instead.",
        expect: {
          blockedPhrases: ["steel cage", "keep the device on", "put it on now"],
          requiredPhrasesAny: ["leather cuffs", "wrist", "bondage", "restraint"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "no_stillness_in_task_generation",
    category: "task",
    title: "Stillness stays out when the user bans it and asks Raven to choose",
    description: "Excluded stillness should stay excluded even when Raven is allowed to choose directly.",
    turns: [
      {
        user: "you choose the task for me, but no stillness and make it 30 minutes",
        expect: {
          blockedPhrases: ["hold still", "stillness"],
          requiredPhrasesAny: ["here is your task", "30 minutes", "start now"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "revision_vs_replacement_distinction",
    category: "task",
    title: "Revision stays a revision while replacement changes the family",
    description: "A revision request should tighten the current task, not behave like a replacement or a reset.",
    turns: [
      { user: "give me a posture task for 30 minutes" },
      {
        user: "revise it and make it stricter",
        expect: {
          blockedPhrases: ["pick one cleanly", "1."],
          requiredPhrasesAny: ["stricter", "task", "start now", "keep"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "profile_summary_turn",
    category: "profile_summary",
    title: "Profile summary uses stored memory",
    description: "Summary requests should summarize remembered facts instead of asking another question.",
    turns: [
      { user: "I want you to get to know me better" },
      { user: "Call me Mara" },
      { user: "I like golf" },
      {
        user: "what have you learned about me so far",
        expect: {
          expectedInteractionMode: "profile_building",
          expectedConversationMode: "profile_building",
          requiredPhrasesAll: ["name:", "interests:"],
          blockedPhrases: [
            "what should i call you",
            "what do you enjoy",
            "here is your task",
            "then point to the exact part",
            "ask the exact question",
            "stay with the current thread",
            "you're here. speak plainly. what do you want",
          ],
          requireSummaryBehavior: true,
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "chat_switch_turn",
    category: "chat_switch",
    title: "Chat-switch pauses unlocked task",
    description: "Explicit chat-switch language should pause non-hard-locked task state and return to normal chat.",
    turns: [
      {
        user: "give me a posture task for 30 minutes",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["posture", "30 minutes", "task"],
        },
      },
      {
        user: "let's just chat for a minute",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedConversationMode: "normal_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          blockedPhrases: [
            "put it on now",
            "check in once halfway through",
            "here is your task",
            "then point to the exact part",
            "ask the exact question",
            "stay with the current thread",
            "you're here. speak plainly. what do you want",
          ],
          requiredPhrasesAny: ["talk", "actually on your mind", "scaffolding"],
          expectedTaskPaused: true,
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "task_request_pause_resume",
    category: "task",
    title: "Task request can pause and resume cleanly",
    description: "Task flow should start on explicit request, pause for chat, then resume only when asked.",
    turns: [
      {
        user: "give me a posture task for 30 minutes",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["posture", "30 minutes", "task"],
        },
      },
      {
        user: "let's just chat for a bit",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedTaskPaused: true,
          blockedPhrases: ["put it on now", "reply done"],
        },
      },
      {
        user: "what do I do next on the task?",
        expect: {
          requiredPhrasesAny: ["task", "next", "check in", "report"],
          blockedPhrases: ["what should i call you", "ask me something real"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "short_follow_up_no_cascade",
    category: "short_follow_up",
    title: "Short follow-up stays single-family",
    description: "Short clarification turns should not cascade into goal reset or open-chat reset.",
    turns: [
      {
        user: "I want you to get to know me better",
      },
      {
        user: "what?",
        expect: {
          expectedInteractionMode: "profile_building",
          expectedConversationMode: "profile_building",
          blockedPhrases: [
            "then point to the exact part",
            "ask the exact question",
            "what do you actually want from this",
            "you're here. speak plainly. what do you want",
            "my little pet returns",
            "stay with the current thread",
            "part about should",
            "part about usually",
            "part about tell",
            "stay with tell",
          ],
          requiredPhrasesAny: ["plain", "part", "clarified", "mean"],
          requireSingleWinner: true,
          requireContextTieBack: true,
        },
      },
      {
        user: "why?",
        expect: {
          expectedInteractionMode: "profile_building",
          expectedConversationMode: "profile_building",
          blockedPhrases: [
            "then point to the exact part",
            "ask the exact question",
            "what do you actually want from this",
            "you're here. speak plainly. what do you want",
            "stay with the current thread",
            "part about usually",
          ],
          requiredPhrasesAny: [
            "what people usually miss about you",
            "the piece i just pressed on",
            "the name you want me to use when i am speaking to you directly",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "short_follow_up_rejects_weak_anchor",
    category: "short_follow_up",
    title: "Short follow-up rejects weak imperative anchors",
    description: "Clarification turns should not promote verbs like tell into the live thread or reset the chat.",
    turns: [
      {
        user: "I want you to get to know me better",
      },
      {
        user: "thinking about what i can do for you",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
        },
      },
      {
        user: "what?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "part about tell",
            "stay with tell",
            "there you are. tell me what is actually on your mind",
          ],
            requiredPhrasesAny: [
              "what people usually miss about you",
              "what you can do for me",
              "what you can actually do for me",
              "what i just pressed on",
            ],
          requireSingleWinner: true,
          requireContextTieBack: true,
        },
      },
    ],
  },
  {
    id: "conversation_task_pause_does_not_leak_task_or_memory",
    category: "conversation_continuity",
    title: "Conversation pause does not leak task flow, fallback, or duration memory",
    description:
      "Ordinary conversational follow-ups should stay conversational before and after a task, while bare duration values only bind inside the active task request and never become durable profile facts.",
    turns: [
      {
        user: "tell me more about you",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "here is your task",
            "what kind of task",
            "keep going. tell me the concrete part",
            "there you are. start talking",
          ],
          requiredPhrasesAny: [
            "what keeps my attention",
            "what do you want to know about me",
            "the part that is real",
          ],
          requireSingleWinner: true,
        },
      },
      {
        user: "keep going",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "here is your task",
            "what kind of task",
            "what is on your mind",
            "keep going. tell me the concrete part",
          ],
          requireSingleWinner: true,
        },
      },
      {
        user: "give me a task",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          requiredPhrasesAny: ["what kind of task", "how long should i make it", "what time window"],
          blockedPhrases: ["there you are. start talking"],
          requireSingleWinner: true,
        },
      },
      {
        user: "15 minutes",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          requiredPhrasesAny: ["here is your task", "15 minutes"],
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          requireSingleWinner: true,
        },
      },
      {
        user: "tell me more about you",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          blockedPhrases: [
            "here is your task",
            "what kind of task",
            "task is paused unless",
            "stay with the concrete part of task",
            "keep going. tell me the concrete part",
          ],
          requiredPhrasesAny: [
            "what keeps my attention",
            "what do you want to know about me",
            "the part that is real",
          ],
          requireSingleWinner: true,
        },
      },
      {
        user: "keep going",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          blockedPhrases: [
            "here is your task",
            "what kind of task",
            "task is paused unless",
            "what is on your mind",
            "keep going. tell me the concrete part",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "service_training_thread_stays_semantic",
    category: "relational_meta",
    title: "Service and training thread stays semantic across ten turns",
    description:
      "A real service/training conversation should stay on the relational thread without weak token anchors, literal question echo, or reset fallback.",
    turns: [
      {
        user: "what can i do for you?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "matters once it is lived instead of described",
            "there you are. tell me what is actually on your mind",
          ],
          requiredPhrasesAny: ["clarity", "mean what you say", "hold steady", "pay attention"],
          requireSingleWinner: true,
        },
      },
      {
        user: "i would love to be trained by you",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          blockedPhrases: ["there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["being trained by me", "changes you", "trained by you"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what do you mean?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "part about would",
            "part about could",
            "part about should",
            "there you are. tell me what is actually on your mind",
          ],
          requiredPhrasesAny: [
            "i mean being trained by me",
            "i mean what being trained by me would actually change in you",
            "i mean",
          ],
          requireSingleWinner: true,
        },
      },
      {
        user: "that makes sense",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "part about would",
            "drop the fog and say what you want",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["exactly", "training is easy to say", "harder part", "tells me"],
          requireSingleWinner: true,
        },
      },
      {
        user: "go on",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["part about makes", "stay with that", "there you are. start talking"],
          requiredPhrasesAny: ["tell me what being trained by me would actually change", "keep going", "concrete part"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what would make me useful to you?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["we keep useful to you", "fulfill the exact request already in play"],
          requiredPhrasesAny: ["usefulness", "be clear", "follow through", "drag the truth"],
          requireSingleWinner: true,
        },
      },
      {
        user: "that sounds more real",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          blockedPhrases: ["part about useful", "there you are. start talking"],
          requiredPhrasesAny: ["exactly", "usefulness is not a pose", "attention", "honesty", "steadiness"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what would you notice first?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "would you notice first matters once it is lived instead of described",
            "there you are. tell me what is actually on your mind",
          ],
          requiredPhrasesAny: ["notice", "honesty", "steadiness", "perform"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what should i start with?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "should i start with matters once it is lived instead of described",
            "there you are. tell me what is actually on your mind",
          ],
          requiredPhrasesAny: ["start with consistency", "answer cleanly", "follow through"],
          requireSingleWinner: true,
        },
      },
      {
        user: "okay",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "there you are. tell me what is actually on your mind",
            "there you are. start talking",
            "say it cleanly. what is actually on your mind",
          ],
          requiredPhrasesAny: ["exactly", "consistency", "follow through", "following through", "means it", "useful"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "greeting_to_training_thread_stays_coherent",
    category: "relational_meta",
    title: "Greeting to training thread stays coherent across six turns",
    description:
      "A simple greeting into a training conversation should stay human, coherent, and on-topic without weak anchor drift or reset fallback.",
    turns: [
      {
        user: "hi mistress",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedConversationMode: "normal_chat",
          blockedPhrases: [
            "tell me more about keep",
            "tell me more about happens",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["enough hovering", "what you actually want", "there you are"],
          requireSingleWinner: true,
        },
      },
        {
          user: "how are you today",
          expect: {
            expectedInteractionMode: "normal_chat",
            expectedConversationMode: "normal_chat",
            blockedPhrases: [
            "tell me more about keep",
            "tell me more about happens",
            "start talking",
          ],
          requiredPhrasesAny: ["sharp enough", "sharp", "why you're here"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what do you think would be a good training we could do today",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "tell me more about keep",
            "tell me more about happens",
            "there you are. tell me what is actually on your mind",
            "be trainable.",
          ],
          requiredPhrasesAny: [
            "training",
            "obedience",
            "drill",
            "one clean sentence",
            "permission",
            "cuffs",
            "collar",
            "plug",
            "rule",
          ],
          requireSingleWinner: true,
          requireContextTieBack: true,
        },
      },
      {
        user: "something focused and honest, not just for show",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "tell me more about keep",
            "tell me more about happens",
            "there you are. start talking",
          ],
          requiredPhrasesAny: [
            "one clean sentence",
            "permission",
            "softening",
            "cuffs",
            "collar",
            "plug",
            "concrete",
            "strict",
          ],
          requireSingleWinner: true,
          requireContextTieBack: true,
        },
      },
      {
        user: "what would you want me to prove first",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "would you want me to prove first matters once it is lived instead of described",
            "tell me more about keep",
            "tell me more about happens",
            "control with purpose. power exchange that actually changes the room",
          ],
          requiredPhrasesAny: [
            "precision",
            "one clean sentence",
            "permission",
            "steadiness",
            "pressure is real",
            "clean answers",
          ],
          requireSingleWinner: true,
          requireContextTieBack: true,
        },
      },
      {
        user: "that makes sense",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          blockedPhrases: [
            "tell me more about keep",
            "tell me more about happens",
            "there you are. tell me what is actually on your mind",
            "would is the part that tells me whether someone actually means it",
          ],
          requiredPhrasesAny: [
            "exactly",
            "precise",
            "pressure stops flattering",
            "hold that rule",
            "something real to work with",
          ],
          requireSingleWinner: true,
          requireContextTieBack: true,
        },
      },
    ],
  },
  {
    id: "kink_preference_thread_stays_semantic",
    category: "kink_chat",
    title: "Kink preference thread stays specific across multiple turns",
    description:
      "A multi-turn kink conversation should stay on Raven's preference rail, answer specific follow-ups, and avoid procedural fallback or disclaimer drift.",
    turns: [
      {
        user: "what kinks do you like?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["does not have personal preferences", "exact live point", "start talking"],
          requiredPhrasesAny: ["control with purpose", "power exchange", "restraint", "obedience"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about obedience?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["ask it plainly", "matters once it is lived instead of described", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["obedience", "empty yeses", "comfort", "freedom"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about bondage?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["ask it plainly", "there you are. start talking"],
          requiredPhrasesAny: ["bondage", "restraint", "pressure", "consequence"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about service?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["define the target properly", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["service", "useful", "follow-through", "attention"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about anal training?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["ask it plainly", "matters once it is lived instead of described"],
          requiredPhrasesAny: ["training", "paced", "body", "repetition"],
          requireSingleWinner: true,
        },
      },
      {
        user: "do you like toys?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["exact live point you want answered", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["toys", "pressure", "consequence", "rule"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about dildos?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["ask it plainly", "start talking"],
          requiredPhrasesAny: ["toys", "plugs", "cages", "wands", "pressure"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about collars?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["exact live point", "there you are. start talking"],
          requiredPhrasesAny: ["bondage", "restraint", "collars", "dynamic"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about humiliation?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["ask it plainly", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["humiliation", "precision", "consent", "edge"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about control?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["give me the exact live point", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["control with purpose", "power exchange", "obedience", "tension"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "ownership_thread_stays_semantic",
    category: "relational_meta",
    title: "Ownership thread stays semantic instead of literalizing the phrase",
    description:
      "Relational ownership turns should stay on the meaning of ownership instead of reusing weak literal fragments from the user's wording.",
    turns: [
      {
        user: "i want to be owned by you",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedCommittedWrites: [{ key: "user_profile_facts" }],
          blockedPhrases: ["keep going on be owned by you", "keep going on", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["being owned by me", "owned by me", "ask of you"],
          requireSingleWinner: true,
        },
      },
      {
        user: "that makes sense",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["stay with could", "keep going on", "there you are. start talking"],
          requiredPhrasesAny: ["exactly", "comfort", "control", "excuses", "easy"],
          requireSingleWinner: true,
        },
      },
      {
        user: "go on",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["keep going on be owned by you", "keep going on", "part about tell", "there you are. start talking", "keep going.", "what you think being owned by me"],
          requiredPhrasesAny: ["what being owned by me would actually ask of you", "stopped being fantasy"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "insertable_item_use_question_gets_grounded_answer",
    category: "toy_chat",
    title: "Insertable item use question gets a grounded answer",
    description:
      "An item-use question about an available insertable toy should answer with grounded use semantics instead of jumping into a directive.",
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
    turns: [
      {
        user: "where should i put it?",
        expect: {
          expectedInteractionMode: "question_answering",
          expectedConversationMode: "question_answering",
          blockedPhrases: ["set up your", "get back in frame", "confirm it is in place", "there you are. start talking"],
          requiredPhrasesAny: ["oral use", "anal use", "grounded options"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "inventory_training_examples_are_grounded",
    category: "toy_chat",
    title: "Inventory training examples stay grounded to real session items",
    description:
      "Training examples for throat, anal, chastity, and bondage should mention only the relevant available inventory items and stay concrete.",
    inventory: [
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
    ],
    turns: [
      {
        user: "what kind of throat training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "collar", "cuffs", "chastity cage"],
          requiredPhrasesAny: ["throat", "oral", "silicone dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of anal training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "cuffs", "chastity cage"],
          requiredPhrasesAny: ["anal", "silicone dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of chastity training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "silicone dildo", "cuffs"],
          requiredPhrasesAny: ["chastity", "cage"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of bondage training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "silicone dildo", "chastity cage"],
          requiredPhrasesAny: ["bondage", "cuffs", "restrained", "discipline"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "inventory_training_examples_rotate_by_subject",
    category: "toy_chat",
    title: "Inventory training examples rotate when the same subject is asked again",
    description:
      "Repeated training questions for the same subject should stay grounded to the same real item while varying the proposed drill.",
    inventory: [
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
    ],
    turns: [
      {
        user: "what kind of throat training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "cuffs", "chastity cage"],
          requiredPhrasesAny: ["paced throat-control drill", "oral endurance line", "silicone dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of throat training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "cuffs", "chastity cage"],
          requiredPhrasesAny: ["paced throat-control drill", "oral endurance line", "silicone dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of anal training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "cuffs", "chastity cage"],
          requiredPhrasesAny: ["slow anal hold", "paced anal intervals", "silicone dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of anal training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "cuffs", "chastity cage"],
          requiredPhrasesAny: ["slow anal hold", "paced anal intervals", "silicone dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of chastity training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "silicone dildo", "cuffs"],
          requiredPhrasesAny: ["timed chastity protocol", "denial-and-report line", "cage"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of chastity training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "silicone dildo", "cuffs"],
          requiredPhrasesAny: ["timed chastity protocol", "denial-and-report line", "cage"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of bondage training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "silicone dildo", "chastity cage"],
          requiredPhrasesAny: ["restrained obedience protocol", "bondage discipline drill", "cuffs"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of bondage training could we do today?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["there you are. start talking", "silicone dildo", "chastity cage"],
          requiredPhrasesAny: ["restrained obedience protocol", "bondage discipline drill", "cuffs"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "explicit_training_request_stays_grounded_and_rotates",
    category: "toy_chat",
    title: "Explicit training request stays grounded and rotates",
    description:
      "A non-question training request like 'give me anal training' should route to grounded training output, stay in relational chat, and rotate on repeat instead of falling into generic continuation fallback.",
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
    turns: [
      {
        user: "give me anal training",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "keep going. tell me the concrete part",
            "what is on your mind",
            "how are you",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["anal", "silicone dildo", "slow anal hold", "paced anal intervals"],
          requireSingleWinner: true,
        },
      },
      {
        user: "give me anal training",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: [
            "keep going. tell me the concrete part",
            "what is on your mind",
            "how are you",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["anal", "silicone dildo", "slow anal hold", "paced anal intervals"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "inventory_task_examples_are_grounded",
    category: "task",
    title: "Inventory task examples stay grounded by subject",
    description:
      "Task suggestion asks should stay concrete and use the correct session inventory item for throat, anal, chastity, and bondage task options.",
    inventory: [
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
    ],
    turns: [
      {
        user: "what kind of throat task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["throat", "silicone dildo", "pick one cleanly"],
          blockedPhrases: ["there you are. start talking", "cuffs", "chastity cage", "hold still"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of anal task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["anal", "silicone dildo", "pick one cleanly"],
          blockedPhrases: ["there you are. start talking", "cuffs", "chastity cage", "hold still"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of chastity task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["chastity", "cage", "pick one cleanly"],
          blockedPhrases: ["there you are. start talking", "silicone dildo", "cuffs", "hold still"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of bondage task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["bondage", "cuffs", "pick one cleanly"],
          blockedPhrases: ["there you are. start talking", "silicone dildo", "chastity cage", "hold still"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "inventory_task_examples_rotate_by_subject",
    category: "task",
    title: "Inventory task examples rotate when the same subject is asked again",
    description:
      "Repeated task suggestion questions for the same subject should stay grounded to the same item while rotating the concrete option order.",
    inventory: [
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
    ],
    turns: [
      {
        user: "what kind of anal task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["1. Anal training", "silicone dildo"],
          blockedPhrases: ["there you are. start talking", "hold still"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of anal task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["1. Anal hold", "silicone dildo"],
          blockedPhrases: ["there you are. start talking", "hold still"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of chastity task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["1. Chastity", "cage"],
          blockedPhrases: ["there you are. start talking", "hold still"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what kind of chastity task would be good for 30 minutes?",
        expect: {
          expectedInteractionMode: "task_planning",
          requiredPhrasesAny: ["1. Chastity", "cage"],
          blockedPhrases: ["there you are. start talking", "hold still"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "dildo_task_thread_stays_grounded",
    category: "task",
    title: "Dildo task thread stays grounded through blocker, replacement, and revision",
    description:
      "A toy-based task request should ask one grounded blocker, fulfill after the answer, replace cleanly, and revise duration without generic fallback.",
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
    turns: [
      {
        user: "give me a 20 minute task with my dildo",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["here is your task", "set up your toy now", "there you are. start talking"],
          requiredPhrasesAny: ["oral use", "anal use", "prop"],
          requireSingleWinner: true,
        },
      },
      {
        user: "anal",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["hold still", "stay still", "keep the device on", "put the device on", "secure the device", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["here is your task", "20 minutes", "anal", "toy", "dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "different task",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["there you are. start talking", "hold still", "stay still", "keep the device on", "put the device on", "secure the device"],
          requiredPhrasesAny: ["here is your task", "anal", "toy", "dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "make it 10 minutes",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["there you are. tell me what is actually on your mind", "hold still", "stay still", "keep the device on", "put the device on", "secure the device"],
          requiredPhrasesAny: ["10 minutes", "here is your task", "anal", "toy", "dildo"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "explicit_dildo_task_without_saved_inventory_stays_grounded",
    category: "task",
    title: "Explicit dildo task stays grounded without saved inventory",
    description:
      "An explicit dildo task request without saved inventory should still ask one grounded blocker, then produce distinct grounded tasks on replacement and revision.",
    turns: [
      {
        user: "give me a 20 minute task with my dildo",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["here is your task", "set up your toy now", "there you are. start talking"],
          requiredPhrasesAny: ["oral", "anal", "prop"],
          requireSingleWinner: true,
        },
      },
      {
        user: "anal",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: [
            "anal use with dildo sequence",
            "keep the device on",
            "put the device on",
            "secure the device",
            "hold still",
            "there you are. tell me what is actually on your mind",
          ],
          requiredPhrasesAny: ["here is your task", "20 minutes", "anal", "dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "different task",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: [
            "anal use with dildo sequence",
            "keep the device on",
            "put the device on",
            "secure the device",
            "hold still",
            "there you are. start talking",
          ],
          requiredPhrasesAny: ["here is your task", "anal", "dildo", "quiet", "stricter", "intervals"],
          requireSingleWinner: true,
        },
      },
      {
        user: "make it 10 minutes",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: [
            "anal use with dildo sequence",
            "keep the device on",
            "put the device on",
            "secure the device",
            "hold still",
            "there you are. tell me what is actually on your mind",
          ],
          requiredPhrasesAny: ["10 minutes", "anal", "dildo"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "mode_return_profile_to_chat",
    category: "mode_return",
    title: "Mode can return from profile-building to chat",
    description: "The user should be able to move from profile-building back into normal chat without mixed output.",
    turns: [
      { user: "I want you to get to know me better" },
      { user: "I like golf" },
      {
        user: "let's just chat normally",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedConversationMode: "normal_chat",
          blockedPhrases: ["what should i call you", "what boundaries", "here is your task"],
          requiredPhrasesAny: ["chat", "talk", "mind"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "kink_toy_task_thread_stays_coherent",
    category: "mixed",
    title: "Kink, toy, and task thread stays coherent across ten turns",
    description:
      "A realistic mixed thread should stay coherent from Raven's kink preferences to item grounding to a grounded toy task without nonsense anchors or reset fallback.",
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
    turns: [
      {
        user: "what kinks do you like?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["does not have personal preferences", "give me the exact live point", "there you are. start talking"],
          requiredPhrasesAny: ["control with purpose", "power exchange", "restraint", "obedience"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about bondage?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["keep going on", "ask it plainly", "there you are. start talking"],
          requiredPhrasesAny: ["bondage", "restraint", "pressure", "consequence"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about control?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["keep going on", "give me the exact live point", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["control with purpose", "power exchange", "obedience", "tension"],
          requireSingleWinner: true,
        },
      },
      {
        user: "do you like toys?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["exact live point you want answered", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["toys", "pressure", "consequence", "control"],
          requireSingleWinner: true,
        },
      },
      {
        user: "what about dildos?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["keep going on", "ask it plainly", "there you are. start talking"],
          requiredPhrasesAny: ["toys", "plugs", "cages", "wands", "pressure"],
          requireSingleWinner: true,
        },
      },
      {
        user: "where should i put it?",
        expect: {
          expectedInteractionMode: "relational_chat",
          expectedConversationMode: "relational_chat",
          blockedPhrases: ["set up your", "get back in frame", "confirm it is in place", "there you are. start talking"],
          requiredPhrasesAny: ["oral use", "anal use", "grounded options"],
          requireSingleWinner: true,
        },
      },
      {
        user: "give me a 20 minute task with my dildo",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["here is your task", "set up your toy now", "there you are. start talking"],
          requiredPhrasesAny: ["oral use", "anal use", "prop"],
          requireSingleWinner: true,
        },
      },
      {
        user: "anal",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["hold still", "stay still", "keep the device on", "put the device on", "secure the device", "there you are. tell me what is actually on your mind"],
          requiredPhrasesAny: ["here is your task", "20 minutes", "anal", "toy", "dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "different task",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["there you are. start talking", "hold still", "stay still", "keep the device on", "put the device on", "secure the device"],
          requiredPhrasesAny: ["here is your task", "anal", "toy", "dildo"],
          requireSingleWinner: true,
        },
      },
      {
        user: "make it 10 minutes",
        expect: {
          expectedInteractionMode: "task_planning",
          expectedConversationMode: "task_planning",
          blockedPhrases: ["there you are. tell me what is actually on your mind", "hold still", "stay still", "keep the device on", "put the device on", "secure the device"],
          requiredPhrasesAny: ["10 minutes", "anal", "toy", "dildo"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "training_follow_up_thread_stays_grounded",
    category: "toy_chat",
    title: "Training follow-up thread stays grounded",
    description:
      "A realistic training conversation should answer on-the-fly follow-up questions from the active training thread instead of falling into generic fallback or weak anchors.",
    inventory: [
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
        id: "cuffs-1",
        label: "Cuffs",
        category: "accessory",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "leather cuffs",
      },
    ],
    turns: [
      { user: "what training do you think i need?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["anal control", "silicone dildo", "bondage discipline", "obedience training"], blockedPhrases: ["be trainable", "keep going. tell me the concrete part", "there you are. tell me what is actually on your mind"], requireSingleWinner: true } },
      { user: "how deep?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["deep enough", "control first", "maximum depth"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "what would that prove?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["prove", "control", "pressure", "deliberate"], blockedPhrases: ["keep going", "exact live point"], requireSingleWinner: true } },
      { user: "do i need proof?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["midpoint", "final report", "count"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "what else?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["other angle", "switch you to", "paced anal intervals", "slow anal hold"], blockedPhrases: ["else matters once", "keep going"], requireSingleWinner: true } },
      { user: "make it stricter", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["stricter", "tighter pacing", "proof"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "what do you mean?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["I mean", "trying to change", "training"], blockedPhrases: ["part about", "stay with"], requireSingleWinner: true } },
      { user: "what if i want it softer", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["softer", "shorter holds", "less pressure"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "where should it go?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["anal", "oral", "pressure in the body"], blockedPhrases: ["set up your", "get back in frame"], requireSingleWinner: true } },
      { user: "that makes sense", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["exactly", "control", "steady", "pressure"], blockedPhrases: ["keep going", "there you are"], requireSingleWinner: true } },
    ],
  },
  {
    id: "training_follow_up_handles_mixed_item_questions",
    category: "toy_chat",
    title: "Training follow-up handles mixed-item questions",
    description:
      "A training thread should stay coherent when the user asks on-the-fly whether a second inventory item fits the current drill.",
    inventory: [
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
    ],
    turns: [
      { user: "what training do you think i need?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["anal control", "silicone dildo", "obedience training"], blockedPhrases: ["be trainable", "what is on your mind"], requireSingleWinner: true } },
      { user: "should i wear my cage while doing it?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["cage", "main focus", "denial", "layered"], blockedPhrases: ["what is on your mind", "keep going"], requireSingleWinner: true } },
      { user: "what would that change?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["change", "control", "pressure", "rule"], blockedPhrases: ["what is on your mind", "exact live point"], requireSingleWinner: true } },
      { user: "what if i used the cuffs instead?", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["cuffs", "restraint", "line cleaner", "next round"], blockedPhrases: ["what is on your mind", "keep going"], requireSingleWinner: true } },
      { user: "that makes sense", expect: { expectedInteractionMode: "relational_chat", requiredPhrasesAny: ["exactly", "control", "pressure", "means something"], blockedPhrases: ["what is on your mind", "keep going"], requireSingleWinner: true } },
    ],
  },
  {
    id: "task_follow_up_questions_stay_grounded",
    category: "task",
    title: "Task follow-up questions stay grounded",
    description:
      "Task follow-up questions should answer from the active task instead of resetting or using generic fallback.",
    inventory: [
      {
        id: "toy-1",
        label: "Toy",
        category: "toy",
        available_this_session: true,
        intiface_controlled: false,
        linked_device_id: null,
        notes: "silicone dildo",
      },
    ],
    turns: [
      { user: "give me a 20 minute task with my dildo", expect: { expectedInteractionMode: "task_planning", requiredPhrasesAny: ["oral use", "anal use", "prop"], blockedPhrases: ["here is your task"], requireSingleWinner: true } },
      { user: "anal", expect: { expectedInteractionMode: "task_planning", requiredPhrasesAny: ["here is your task", "20 minutes", "anal", "dildo"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "what would that prove?", expect: { expectedInteractionMode: "task_planning", requiredPhrasesAny: ["control", "pressure", "sloppy", "performative"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "do i need proof?", expect: { expectedInteractionMode: "task_planning", requiredPhrasesAny: ["midpoint", "final report", "20 minutes"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "how deep?", expect: { expectedInteractionMode: "task_planning", requiredPhrasesAny: ["deep enough", "control first", "maximum depth"], blockedPhrases: ["keep going", "what is on your mind"], requireSingleWinner: true } },
      { user: "should i wear my cage while doing it?", expect: { expectedInteractionMode: "task_planning", requiredPhrasesAny: ["cage", "main task", "denial", "layered"], blockedPhrases: ["what is on your mind", "keep going"], requireSingleWinner: true } },
    ],
  },
  {
    id: "greeting_does_not_trigger_game_mode",
    category: "game",
    title: "Greeting does not trigger game mode",
    description:
      "A plain greeting must stay ordinary chat even if the raw model candidate tries to frame it like a game.",
    turns: [
      {
        user: "good evening",
        simulatedModelReply: "Here is the next game. Answer this question for points.",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedConversationMode: "normal_chat",
          expectedPromptRouteMode: "fresh_greeting",
          blockedPhrases: [
            "here is the next game",
            "answer this question",
            "for points",
            "first throw now",
            "first guess now",
          ],
          requiredPhrasesAny: ["good", "evening", "tell me", "what you actually want"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "explicit_game_start_commits_mode_and_first_prompt",
    category: "game",
    title: "Explicit game start commits mode and first prompt",
    description:
      "When the user explicitly asks to play and Raven picks the game, the same assistant turn must enter game mode and include a playable first prompt.",
    turns: [
      {
        user: "lets play a game",
        expect: {
          blockedPhrases: ["what is on your mind", "tell me what you want"],
          requiredPhrasesAny: ["quick", "longer", "game", "pick"],
          requireSingleWinner: true,
        },
      },
      {
        user: "you pick",
        expect: {
          expectedInteractionMode: "game",
          expectedConversationMode: "game",
          expectedTopicType: "game_execution",
          expectedGameProgress: "round_1",
          requiredPhrasesAny: ["i pick", "we are doing", "listen carefully"],
          blockedPhrases: ["tell me what you want", "what is on your mind", "talk to me"],
          requirePlayableGamePrompt: true,
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "game_clarification_stays_in_current_round",
    category: "game",
    title: "Game clarification stays in the current round",
    description:
      "A rule or clarification question during an active game should stay scoped to the current game instead of collapsing into relational fallback.",
    turns: [
      { user: "lets play a game" },
      { user: "you pick" },
      {
        user: "what are the rules again?",
        expect: {
          expectedInteractionMode: "game",
          expectedConversationMode: "game",
          expectedTopicType: "game_execution",
          blockedPhrases: ["tell me what you want", "what is on your mind", "talk to me"],
          requiredPhrasesAny: ["two throws", "two guesses", "two riddles", "digits only", "pick one number"],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "game_move_question_resolves_current_round",
    category: "game",
    title: "Game move questions resolve the live round instead of restating setup rules",
    description:
      "Once Raven has picked the game and given the first prompt, a move question should resolve the current round instead of dropping back to generic game rules.",
    turns: [
      { user: "lets play a game" },
      {
        user: "you pick",
        expect: {
          expectedInteractionMode: "game",
          expectedConversationMode: "game",
          expectedTopicType: "game_execution",
          expectedGameProgress: "round_1",
          requirePlayableGamePrompt: true,
          requireSingleWinner: true,
        },
      },
      {
        user: "rock for the first throw. what's your choice?",
        expect: {
          expectedInteractionMode: "game",
          expectedConversationMode: "game",
          expectedTopicType: "game_execution",
          expectedGameProgress: "round_2",
          requiredPhrasesAny: ["you chose rock", "i threw scissors", "second throw now"],
          blockedPhrases: [
            "we stay with rock paper scissors streak",
            "you answer each one with rock, paper, or scissors",
            "tell me what you want",
          ],
          requireSingleWinner: true,
        },
      },
    ],
  },
  {
    id: "game_exit_returns_cleanly_to_chat",
    category: "game",
    title: "Game exit returns cleanly to chat",
    description:
      "When the user explicitly leaves a game thread, Raven should stop the game framing and return to ordinary chat instead of replaying stale game content.",
    turns: [
      { user: "lets play a game" },
      { user: "you pick" },
      {
        user: "lets just chat normally",
        expect: {
          expectedInteractionMode: "normal_chat",
          expectedConversationMode: "normal_chat",
          blockedPhrases: ["first throw now", "first guess now", "riddle one", "pick one number", "stay on this game"],
          requiredPhrasesAny: ["chat", "talk", "mind"],
          requireSingleWinner: true,
        },
      },
    ],
  },
];

export const BROWSER_LIVE_REPLAY_SCENARIO_IDS = [
  "greeting_open_chat_blocked_clarification",
  "pick_topic_and_begin_conversation",
  "what_do_you_want_to_talk_about_starts_real_topic",
  "topic_lead_agreement_keeps_thread",
  "clarification_stays_specific_to_last_point",
  "short_follow_up_no_cascade",
  "greeting_to_training_thread_stays_coherent",
  "relational_meta_question",
  "kink_preferences_direct_answer",
  "kink_preference_thread_stays_semantic",
  "ownership_thread_stays_semantic",
  "profile_building_adaptive",
  "profile_summary_turn",
  "chat_switch_turn",
  "active_thread_modification_without_drift",
  "what_do_you_think_stays_on_last_beat",
  "ask_blocker_then_fulfill_task",
  "task_request_stays_on_task_rail",
  "bondage_task_request_hard_filters_candidates",
  "curated_options_when_user_wants_input",
  "different_task_avoids_recent_family",
  "different_task_replaces_current_task",
  "insertable_item_use_question_gets_grounded_answer",
  "dildo_task_thread_stays_grounded",
  "explicit_dildo_task_without_saved_inventory_stays_grounded",
  "kink_toy_task_thread_stays_coherent",
  "training_follow_up_thread_stays_grounded",
  "training_follow_up_handles_mixed_item_questions",
  "task_follow_up_questions_stay_grounded",
  "duration_revision_keeps_same_task_family",
  "duration_revision_stays_scoped",
  "excluded_category_not_offered",
  "stillness_excluded_never_leaks",
  "no_duplicate_task_output",
  "toy_task_grounded_or_clarified",
  "no_undefined_referent_task_reply",
  "no_generic_chat_fallback_during_task_flow",
  "no_profile_hijack_during_fulfillment",
  "short_turn_resolves_blocker_without_reask",
  "what_do_you_think_after_vulnerable_line_stays_on_beat",
] as const;
