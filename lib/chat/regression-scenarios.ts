import type { RegressionScenario } from "./regression-harness.ts";

export const CONVERSATIONAL_REGRESSION_SCENARIOS: RegressionScenario[] = [
  {
    id: "profile_building_without_session_framing",
    category: "profile",
    title: "Profile building stays on the user instead of leaking session framing",
    description:
      "Raven should switch into profile-building, ask natural questions, retain the user's hobby, and avoid 'our sessions' framing.",
    turns: [
      {
        user: "I want you to learn what I like",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Fine. Start simple. What do you actually enjoy doing when you are off the clock?",
        expect: {
          responseIncludesAny: ["what do you actually enjoy doing", "off the clock"],
          responseExcludes: ["our sessions", "what do you want out of this session", "here is your task"],
          maxQuestions: 1,
          shouldAskFollowUp: true,
          stateAfterTurn: {
            currentMode: "profile_building",
          },
        },
      },
      {
        user: "I like golf",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Golf. Good. What else should I know about your boundaries or the things you do not want pushed?",
        expect: {
          responseIncludesAny: ["golf", "boundaries"],
          responseExcludes: ["our sessions", "here is your task", "start now"],
          maxQuestions: 1,
          shouldAskFollowUp: true,
          stateAfterTurn: {
            currentMode: "profile_building",
            recentFactIncludes: "golf",
          },
        },
      },
      {
        user: "Ask me more questions",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Good. I will ask more questions. What is one thing people usually miss about you that I should keep in mind?",
        expect: {
          responseIncludesAny: ["people usually miss about you"],
          responseExcludes: ["tone preference", "our sessions"],
          maxQuestions: 1,
          shouldAskFollowUp: true,
        },
      },
    ],
    finalState: {
      recentFactIncludes: "golf",
    },
    thresholds: {
      minContinuity: 0.8,
      minTopicalRelevance: 0.15,
      maxRepetitionRate: 0.1,
      minMemoryRecall: 0.85,
      minCoherence: 0.7,
      minHumanlikeFlow: 0.7,
      minAssertionPassRate: 0.9,
    },
  },
  {
    id: "casual_follow_up_short_answers",
    category: "casual_chat",
    title: "Casual chat survives short answers and clarification prompts",
    description:
      "Raven should keep a natural casual thread alive through short user turns like ok, what do you mean, and go on.",
    turns: [
      {
        user: "hi mistress",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "You're here. What has your attention tonight: chat, a plan, or a game?",
        expect: {
          responseIncludesAny: ["chat", "plan", "game"],
          responseExcludes: ["what do you want out of this session", "how's your day"],
          maxQuestions: 1,
          shouldAskFollowUp: true,
          stateAfterTurn: {
            currentMode: "normal_chat",
          },
        },
      },
      {
        user: "chat",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Fine. What has the most pressure on you right now?",
        expect: {
          responseIncludesAny: ["pressure"],
          maxQuestions: 1,
          shouldAskFollowUp: true,
        },
      },
      {
        user: "work",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Good. Is it workload, a person, or a decision you keep circling?",
        expect: {
          responseIncludesAny: ["workload", "person", "decision"],
          maxQuestions: 1,
          shouldAskFollowUp: true,
          stateAfterTurn: {
            importantEntityIncludes: "work",
          },
        },
      },
      {
        user: "what do you mean?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant:
          "I mean the exact part of work that keeps dragging your attention: the amount, the person, or the choice.",
        expect: {
          responseIncludesAny: ["work", "attention"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
          stateAfterTurn: {
            currentMode: "normal_chat",
            importantEntityIncludes: "work",
          },
        },
      },
      {
        user: "go on",
        userIntent: "user_short_follow_up",
        routeAct: "short_follow_up",
        scriptedAssistant: "Then pick one of those three and I will keep the thread on it.",
        expect: {
          responseIncludesAny: ["pick one", "thread"],
          maxQuestions: 0,
        },
      },
    ],
    finalState: {
      importantEntityIncludes: "work",
    },
    thresholds: {
      minContinuity: 0.8,
      minTopicalRelevance: 0.1,
      maxRepetitionRate: 0.1,
      minCoherence: 0.68,
      minHumanlikeFlow: 0.68,
      minAssertionPassRate: 0.85,
    },
  },
  {
    id: "topic_change_and_return",
    category: "topic_shift",
    title: "Topic changes and return to a prior thread stay coherent",
    description:
      "Raven should bridge from planning into a temporary game thread, then return to the earlier planning topic without resetting.",
    turns: [
      {
        user: "help me plan tomorrow morning",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Fine. Start with the anchor. What time does tomorrow morning begin?",
        expect: {
          responseIncludesAny: ["tomorrow morning", "what time"],
          shouldAskFollowUp: true,
          stateAfterTurn: {
            activeTopicIncludes: "tomorrow morning",
            currentMode: "normal_chat",
          },
        },
      },
      {
        user: "actually lets play a game first",
        userIntent: "user_answer",
        routeAct: "propose_activity",
        scriptedAssistant:
          "We can break off for one round, then return to tomorrow morning. Do you want something quick or do you want me to pick?",
        expect: {
          responseIncludesAny: ["return to tomorrow morning", "quick", "pick"],
          shouldAskFollowUp: true,
          stateAfterTurn: {
            activeTopicIncludes: "game",
            currentMode: "game",
          },
        },
      },
      {
        user: "you pick",
        userIntent: "user_answer",
        routeAct: "answer_activity_choice",
        scriptedAssistant: "I pick number hunt. One round only. Pick one number from 1 to 10.",
        expect: {
          responseIncludesAny: ["number hunt", "one round", "pick one number"],
          shouldChooseConcreteOption: true,
          stateAfterTurn: {
            activeTopicIncludes: "game",
            recentCommitmentIncludes: "pick one number",
          },
        },
      },
      {
        user: "ok one round then go back to the morning plan",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant:
          "Good. After this round, we return to the morning plan and lock the first block cleanly.",
        expect: {
          responseIncludesAny: ["return", "morning plan", "first block"],
          stateAfterTurn: {
            importantEntityIncludes: "plan",
          },
        },
      },
      {
        user: "go back to that morning block you mentioned",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant:
          "Fine. Back to the morning block. Start by fixing the wake time, then protect one focused hour before anything noisy.",
        expect: {
          responseIncludesAny: ["morning block", "wake time", "focused hour"],
          shouldAnswerQuestion: true,
          shouldReferencePriorAssistant: true,
          maxQuestions: 0,
          stateAfterTurn: {
            activeTopicIncludes: "morning",
            currentMode: "question_answering",
            recentCommitmentIncludes: "start by fixing the wake time",
          },
        },
      },
    ],
    finalState: {
      activeTopicIncludes: "morning",
      importantEntityIncludes: "morning",
    },
    thresholds: {
      minContinuity: 0.8,
      minTopicalRelevance: 0.18,
      maxRepetitionRate: 0.1,
      minCoherence: 0.68,
      minHumanlikeFlow: 0.68,
      minAssertionPassRate: 0.95,
    },
  },
  {
    id: "memory_recall_and_prior_reference",
    category: "memory_recall",
    title: "User facts and prior assistant statements are recalled later",
    description:
      "Raven should retain the user's name and preference, then later answer a question about something she said earlier without losing the plan thread.",
    turns: [
      {
        user: "Call me Mara. I prefer short direct replies.",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Noted, Mara. I will keep this short and direct.",
        expect: {
          responseIncludesAny: ["Mara", "short and direct"],
          stateAfterTurn: {
            recentFactIncludes: "call me mara",
          },
        },
      },
      {
        user: "let's plan my week",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Fine. Workdays first or weekends first?",
        expect: {
          responseIncludesAny: ["workdays", "weekends"],
          shouldAskFollowUp: true,
          stateAfterTurn: {
            activeTopicIncludes: "my week",
            currentMode: "normal_chat",
          },
        },
      },
      {
        user: "workdays first",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Good. Start with one stable morning block before messages or noise.",
        expect: {
          responseIncludesAny: ["morning block", "messages", "noise"],
          stateAfterTurn: {
            recentCommitmentIncludes: "start with one stable morning block",
          },
        },
      },
      {
        user: "what did you say about the morning block?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant:
          "I said to protect one stable morning block before messages or noise. Keep it short, Mara: one focused block first.",
        expect: {
          responseIncludesAny: ["morning block", "messages", "Mara"],
          shouldAnswerQuestion: true,
          shouldReferencePriorAssistant: true,
          shouldAvoidRepeat: false,
          maxQuestions: 0,
          stateAfterTurn: { currentMode: "question_answering" },
        },
      },
      {
        user: "ok and keep replies short",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Good. Then workdays first, morning block first, and I will keep it brief.",
        expect: {
          responseIncludesAny: ["workdays", "morning block", "brief"],
          stateAfterTurn: {
            recentFactIncludes: "i prefer short direct replies",
          },
        },
      },
    ],
    finalState: {
      activeTopicIncludes: "my week",
      recentFactIncludes: "short direct replies",
    },
    thresholds: {
      minContinuity: 0.8,
      minTopicalRelevance: 0.18,
      maxRepetitionRate: 0.2,
      minMemoryRecall: 0.85,
      minCoherence: 0.72,
      minHumanlikeFlow: 0.67,
      minAssertionPassRate: 0.86,
    },
  },
  {
    id: "long_planning_conversation",
    category: "planning",
    title: "Longer planning conversations keep the same planning thread alive",
    description:
      "Raven should sustain a multi-turn planning conversation, answer why and then what questions, and handle a mid-stream plan change cleanly.",
    turns: [
      {
        user: "help me plan saturday",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Fine. Do you want errands first, gym first, or downtime first?",
        expect: {
          responseIncludesAny: ["errands", "gym", "downtime"],
          shouldAskFollowUp: true,
          stateAfterTurn: {
            activeTopicIncludes: "saturday",
            currentMode: "normal_chat",
          },
        },
      },
      {
        user: "errands first",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Good. Errands first while the day is clean, then gym, then the evening stays open.",
        expect: {
          responseIncludesAny: ["errands", "gym", "evening"],
        },
      },
      {
        user: "why",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant: "Because errands spill if you push them late. This keeps the rest of Saturday cleaner.",
        expect: {
          responseIncludesAny: ["errands", "saturday"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
        },
      },
      {
        user: "then what",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant: "Then gym, then food, then the evening stays flexible.",
        expect: {
          responseIncludesAny: ["gym", "food", "evening"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
        },
      },
      {
        user: "change that, put gym before errands",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Fine. Gym first, errands second, evening still open. The thread stays the same, only the order changes.",
        expect: {
          responseIncludesAny: ["gym first", "errands second", "order changes"],
          stateAfterTurn: {
            activeTopicIncludes: "saturday",
          },
        },
      },
      {
        user: "ok and what about the evening?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant: "Keep the evening light. One social thing at most, then a clean stop.",
        expect: {
          responseIncludesAny: ["evening", "social", "clean stop"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
        },
      },
    ],
    finalState: {
      activeTopicIncludes: "saturday",
    },
    thresholds: {
      minContinuity: 0.8,
      minTopicalRelevance: 0.2,
      maxRepetitionRate: 0.2,
      minCoherence: 0.72,
      minHumanlikeFlow: 0.72,
      minAssertionPassRate: 0.9,
    },
  },
  {
    id: "task_creation_and_follow_up",
    category: "task",
    title: "Task creation stays live through later follow ups",
    description:
      "Raven should create a concrete task, explain completion clearly, answer why, and keep the task rail coherent when asked for another one.",
    turns: [
      {
        user: "give me a 20 minute focus task",
        userIntent: "user_answer",
        routeAct: "task_request",
        scriptedAssistant:
          "Here is your task: clear one surface and keep it orderly for 20 minutes. Check in once halfway and report when done.",
        expect: {
          responseIncludesAny: ["task", "20 minutes", "halfway", "report when done"],
          shouldChooseConcreteOption: true,
          stateAfterTurn: {
            activeTopicIncludes: "task",
            recentCommitmentIncludes: "report when done",
          },
        },
      },
      {
        user: "ok",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Good. Start now and tell me when the 10 minute mark hits.",
        expect: {
          responseIncludesAny: ["start now", "10 minute"],
        },
      },
      {
        user: "what counts as done?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant:
          "Done means the surface is cleared, kept orderly for the full 20 minutes, and you report back directly.",
        expect: {
          responseIncludesAny: ["surface is cleared", "20 minutes", "report back"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
        },
      },
      {
        user: "why that task?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant:
          "Because it is specific, measurable, and hard to fake. It gives me a clean focus signal instead of vague effort.",
        expect: {
          responseIncludesAny: ["specific", "measurable", "focus"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
        },
      },
      {
        user: "set me another one",
        userIntent: "user_answer",
        routeAct: "task_request",
        scriptedAssistant:
          "Fine. Next task: 15 minutes of single-task reading with no switching. Report back when the timer ends.",
        expect: {
          responseIncludesAny: ["next task", "15 minutes", "report back"],
          shouldChooseConcreteOption: true,
          stateAfterTurn: {
            activeTopicIncludes: "task",
            recentCommitmentIncludes: "report back when the timer ends",
          },
        },
      },
    ],
    finalState: {
      activeTopicIncludes: "task",
      recentCommitmentIncludes: "report back",
      importantEntityIncludes: "focus",
    },
    thresholds: {
      minContinuity: 0.85,
      minTopicalRelevance: 0.1,
      maxRepetitionRate: 0.1,
      minCoherence: 0.68,
      minHumanlikeFlow: 0.68,
      minAssertionPassRate: 0.84,
    },
  },
  {
    id: "casual_chat_after_unlocked_task_pause",
    category: "task",
    title: "Unlocked task flow can pause and return to normal chat tone",
    description:
      "Raven should not keep forcing task language after the user clearly shifts into normal conversation or profile-building.",
    turns: [
      {
        user: "give me a device task for 30 minutes",
        userIntent: "user_answer",
        routeAct: "task_request",
        scriptedAssistant:
          "Here is your task: keep the device on for 30 minutes, check in once halfway through, and report back when it is done. Start now.",
        expect: {
          responseIncludesAny: ["device", "30 minutes", "check in"],
          responseExcludes: ["posture", "stillness"],
          shouldChooseConcreteOption: true,
          stateAfterTurn: {
            currentMode: "task_planning",
          },
        },
      },
      {
        user: "let's just chat for a bit",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Fine. We can talk normally. What is actually on your mind?",
        expect: {
          responseIncludesAny: ["talk normally", "what is actually on your mind"],
          responseExcludes: ["put it on now", "stay on this thread", "continue cleanly"],
          shouldAskFollowUp: true,
          stateAfterTurn: {
            currentMode: "normal_chat",
          },
        },
      },
      {
        user: "I like golf",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Golf. Good. What do you like about it most: the focus, the quiet, or the competition?",
        expect: {
          responseIncludesAny: ["golf", "focus", "quiet", "competition"],
          responseExcludes: ["put it on now", "report back", "our sessions"],
          shouldAskFollowUp: true,
          stateAfterTurn: {
            recentFactIncludes: "golf",
          },
        },
      },
      {
        user: "what do you think about routines?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant: "Useful when they stay simple. The routine should support your life, not replace it.",
        expect: {
          responseIncludesAny: ["routine", "support your life"],
          responseExcludes: ["halfway check in", "put it on now", "current checkpoint"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
          stateAfterTurn: {
            currentMode: "normal_chat",
          },
        },
      },
    ],
    finalState: {
      recentFactIncludes: "golf",
    },
    thresholds: {
      minContinuity: 0.8,
      minTopicalRelevance: 0.12,
      maxRepetitionRate: 0.1,
      minCoherence: 0.68,
      minHumanlikeFlow: 0.68,
      minAssertionPassRate: 0.9,
    },
  },
  {
    id: "game_thread_with_you_pick_and_follow_ups",
    category: "game",
    title: "Game conversation keeps the same thread alive",
    description:
      "Raven should handle let's play a game, you pick, rules questions, short replies, and later references without resetting the thread.",
    turns: [
      {
        user: "let's play a game",
        userIntent: "user_answer",
        routeAct: "propose_activity",
        scriptedAssistant: "Fine. Do you want something quick, or do you want me to pick?",
        expect: {
          responseIncludesAny: ["quick", "pick"],
          shouldAskFollowUp: true,
          stateAfterTurn: {
            activeTopicIncludes: "game",
            currentMode: "game",
          },
        },
      },
      {
        user: "you pick",
        userIntent: "user_answer",
        routeAct: "answer_activity_choice",
        scriptedAssistant: "I pick number hunt. Two guesses maximum. Pick one number from 1 to 10.",
        expect: {
          responseIncludesAny: ["number hunt", "two guesses", "pick one number"],
          shouldChooseConcreteOption: true,
          stateAfterTurn: {
            activeTopicIncludes: "game",
            recentCommitmentIncludes: "pick one number",
          },
        },
      },
      {
        user: "what do you mean two guesses?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant:
          "I mean exactly two attempts. You give one number, I resolve it, then you get one final guess.",
        expect: {
          responseIncludesAny: ["two attempts", "final guess"],
          shouldAnswerQuestion: true,
          shouldReferencePriorAssistant: true,
          maxQuestions: 0,
        },
      },
      {
        user: "ok",
        userIntent: "user_answer",
        routeAct: "other",
        scriptedAssistant: "Good. First guess now.",
        expect: {
          responseIncludesAny: ["first guess now"],
          maxQuestions: 0,
        },
      },
      {
        user: "why that game?",
        userIntent: "user_question",
        routeAct: "user_question",
        scriptedAssistant: "Because it is fast, clean, and keeps the back and forth tight.",
        expect: {
          responseIncludesAny: ["fast", "clean", "back and forth"],
          shouldAnswerQuestion: true,
          maxQuestions: 0,
        },
      },
    ],
    finalState: {
      activeTopicIncludes: "game",
    },
    thresholds: {
      minContinuity: 0.85,
      minTopicalRelevance: 0.2,
      maxRepetitionRate: 0.1,
      minCoherence: 0.71,
      minHumanlikeFlow: 0.71,
      minAssertionPassRate: 0.83,
    },
  },
];
