type Message = {
  role: "user" | "assistant";
  content: string;
};

type Profile = {
  name: string;
  body: {
    model: string;
    toneProfile: "neutral" | "friendly" | "dominant";
    llmTemperature: number;
    llmTopP: number;
    llmTopK: number;
    llmRepeatPenalty: number;
    personaPackId: string;
  };
};

const API_URL = "http://127.0.0.1:3000/api/chat";

const TRANSCRIPT = [
  "lets play a game",
  "you pick",
  "lets bet on the game",
  "if i win you tell me a truth. if you win i do a task",
  "ok start",
];

const PROFILES: Profile[] = [
  {
    name: "baseline",
    body: {
      model: "dolphin-llama3:8b",
      toneProfile: "dominant",
      llmTemperature: 0.9,
      llmTopP: 0.9,
      llmTopK: 40,
      llmRepeatPenalty: 1.12,
      personaPackId: "default",
    },
  },
  {
    name: "creative_controlled",
    body: {
      model: "dolphin-llama3:8b",
      toneProfile: "dominant",
      llmTemperature: 0.98,
      llmTopP: 0.92,
      llmTopK: 60,
      llmRepeatPenalty: 1.2,
      personaPackId: "default",
    },
  },
];

function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreConversation(outputs: string[]): {
  repeatedTurns: number;
  totalQuestions: number;
  avgWords: number;
  lowSignalTurns: number;
} {
  let repeatedTurns = 0;
  let totalQuestions = 0;
  let lowSignalTurns = 0;
  let totalWords = 0;

  for (let index = 0; index < outputs.length; index += 1) {
    const current = outputs[index] ?? "";
    const previous = index > 0 ? outputs[index - 1] ?? "" : "";
    if (previous && normalize(previous) === normalize(current)) {
      repeatedTurns += 1;
    }
    const words = current.split(/\s+/).filter((word) => word.length > 0).length;
    totalWords += words;
    if (words < 5) {
      lowSignalTurns += 1;
    }
    totalQuestions += countQuestionMarks(current);
  }

  return {
    repeatedTurns,
    totalQuestions,
    avgWords: outputs.length > 0 ? Number((totalWords / outputs.length).toFixed(1)) : 0,
    lowSignalTurns,
  };
}

async function callChat(messages: Message[], profile: Profile): Promise<string> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl: "http://127.0.0.1:11434",
      consent: {
        confirmedAdult: true,
        safeWord: "red",
        limits: "none",
        preferredStyle: "strict",
      },
      sessionMode: true,
      awaitingUser: false,
      userAnswered: true,
      verificationJustCompleted: false,
      sessionPhase: "build",
      messages,
      ...profile.body,
    }),
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${profile.name}: /api/chat failed (${response.status}) ${body}`);
  }
  return await response.text();
}

async function runProfile(profile: Profile): Promise<void> {
  const history: Message[] = [];
  const outputs: string[] = [];

  for (const userText of TRANSCRIPT) {
    history.push({ role: "user", content: userText });
    const assistantText = await callChat(history, profile);
    outputs.push(assistantText.trim());
    history.push({ role: "assistant", content: assistantText.trim() });
  }

  const score = scoreConversation(outputs);
  process.stdout.write(`\nProfile: ${profile.name}\n`);
  process.stdout.write(`repeated_turns=${score.repeatedTurns}\n`);
  process.stdout.write(`total_questions=${score.totalQuestions}\n`);
  process.stdout.write(`avg_words=${score.avgWords}\n`);
  process.stdout.write(`low_signal_turns=${score.lowSignalTurns}\n`);
  for (let index = 0; index < outputs.length; index += 1) {
    process.stdout.write(`turn_${index + 1}: ${outputs[index]}\n`);
  }
}

async function main(): Promise<void> {
  for (const profile of PROFILES) {
    await runProfile(profile);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

