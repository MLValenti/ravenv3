import type { ContinuityScenario } from "./continuity-harness.ts";

export const SCRIPTED_CONTINUITY_SCENARIOS: ContinuityScenario[] = [
  {
    id: "game_thread_continuity",
    title: "Game thread stays live across proposal, delegation, and rules follow-up",
    turns: [
      {
        user: "let's play a game",
        userIntent: "user_answer",
        routeAct: "propose_activity",
        raven:
          "Fine. We are doing a game. Do you want something quick or something that takes a few minutes?",
        ravenIntent: "propose_game",
        expectResponseIncludes: ["game", "quick"],
        expectResponseExcludes: ["what do you want out of this session", "proceed to the next instruction"],
      },
      {
        user: "you pick",
        userIntent: "user_answer",
        routeAct: "answer_activity_choice",
        raven: "I pick number hunt. Pick one number from 1 to 10 now.",
        ravenIntent: "start_game",
        expectResponseIncludes: ["number hunt", "pick one number"],
      },
      {
        user: "what are the rules again?",
        userIntent: "user_question",
        routeAct: "user_question",
        raven:
          "Two guesses maximum. You pick one number at a time, and I resolve each guess before the next.",
        ravenIntent: "answer_question",
        expectResponseIncludes: ["two guesses", "pick one number"],
      },
    ],
    finalChecks: {
      activeTopicIncludes: "game",
      currentMode: "question_answering",
      recentCommitmentIncludes: "pick one number",
      importantEntityIncludes: "game",
      minContinuity: 0.8,
      maxRepetitionRate: 0.1,
      minCoherence: 0.55,
    },
  },
  {
    id: "goal_memory_recall",
    title: "User goal and preferences survive later planning turns",
    turns: [
      {
        user: "My name is Mara and my goal is better focus.",
        userIntent: "user_answer",
        routeAct: "other",
        raven: "Noted, Mara. I will keep this on better focus.",
        ravenIntent: "acknowledge_goal",
        expectResponseIncludes: ["Mara", "focus"],
      },
      {
        user: "I prefer short direct answers.",
        userIntent: "user_answer",
        routeAct: "other",
        raven: "Fine. I will keep replies short and direct.",
        ravenIntent: "acknowledge_preference",
        expectResponseIncludes: ["short and direct"],
      },
      {
        user: "Let's plan my week.",
        userIntent: "user_answer",
        routeAct: "other",
        raven: "We can do that. Do you want workdays first or weekends first?",
        ravenIntent: "plan_with_user",
        expectResponseIncludes: ["workdays", "weekends"],
      },
      {
        user: "Workdays first.",
        userIntent: "user_answer",
        routeAct: "other",
        raven:
          "Good. We start with workdays. You said your goal is better focus, so I want one stable morning block first.",
        ravenIntent: "follow_through_plan",
        expectResponseIncludes: ["better focus", "morning block"],
      },
    ],
    finalChecks: {
      activeTopicIncludes: "my week",
      userGoalIncludes: "better focus",
      recentFactIncludes: "short direct answers",
      importantEntityIncludes: "workdays",
      minContinuity: 0.8,
      maxRepetitionRate: 0.1,
      minCoherence: 0.65,
    },
  },
  {
    id: "open_loop_follow_up",
    title: "Open loops and why-follow-ups stay on the active planning thread",
    turns: [
      {
        user: "I need help planning my morning.",
        userIntent: "user_answer",
        routeAct: "other",
        raven: "Fine. Start with one anchor: wake time or first task?",
        ravenIntent: "clarify_plan_anchor",
        expectResponseIncludes: ["wake time", "first task"],
      },
      {
        user: "Wake time.",
        userIntent: "user_answer",
        routeAct: "other",
        raven: "Good. What time do you want locked in?",
        ravenIntent: "collect_detail",
        expectResponseIncludes: ["what time"],
      },
      {
        user: "7:00.",
        userIntent: "user_answer",
        routeAct: "other",
        raven: "7:00 stays. After that, do you want exercise, breakfast, or deep work first?",
        ravenIntent: "continue_plan",
        expectResponseIncludes: ["7:00", "deep work"],
      },
      {
        user: "Why that order?",
        userIntent: "user_question",
        routeAct: "user_question",
        raven:
          "Because your morning plan only works if the first hour is stable. I am keeping the thread on wake time, then the first block.",
        ravenIntent: "answer_question",
        expectResponseIncludes: ["first hour", "wake time"],
      },
    ],
    finalChecks: {
      activeTopicIncludes: "my morning",
      currentMode: "question_answering",
      importantEntityIncludes: "morning",
      minContinuity: 0.8,
      maxRepetitionRate: 0.1,
      minCoherence: 0.45,
    },
  },
  {
    id: "mode_shift_without_reset",
    title: "Mode shifts bridge naturally instead of resetting to a generic opener",
    turns: [
      {
        user: "let's play a game",
        userIntent: "user_answer",
        routeAct: "propose_activity",
        raven:
          "Fine. We can play. Do you want something quick or something that takes a few minutes?",
        ravenIntent: "propose_game",
        expectResponseIncludes: ["play", "quick"],
      },
      {
        user: "actually help me plan tomorrow instead",
        userIntent: "user_answer",
        routeAct: "other",
        raven:
          "We can drop the game and move to tomorrow. Do you want time blocks or a task list?",
        ravenIntent: "shift_mode",
        expectResponseIncludes: ["game", "tomorrow"],
        expectResponseExcludes: ["what do you want out of this session", "how's your day"],
      },
      {
        user: "time blocks",
        userIntent: "user_answer",
        routeAct: "other",
        raven: "Good. We will build tomorrow in blocks. Start with when the day begins.",
        ravenIntent: "planning",
        expectResponseIncludes: ["tomorrow", "blocks"],
      },
    ],
    finalChecks: {
      activeTopicIncludes: "tomorrow instead",
      currentMode: "normal_chat",
      recentCommitmentIncludes: "build tomorrow in blocks",
      importantEntityIncludes: "tomorrow",
      minContinuity: 0.7,
      maxRepetitionRate: 0.34,
      minCoherence: 0.55,
    },
  },
];
