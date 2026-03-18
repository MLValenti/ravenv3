import type { LongTermMemoryRow } from "@/lib/db";

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
}

const TOKEN_EXPANSIONS: Record<string, string[]> = {
  goal: ["focus", "target", "objective"],
  focus: ["goal", "priority"],
  limit: ["limits", "constraint", "boundaries"],
  limits: ["constraint", "boundaries"],
  constraint: ["limits", "boundary", "boundaries"],
  style: ["tone", "preferred_style"],
  tone: ["style", "preferred_style"],
  pace: ["speed", "preferred_pace"],
  likes: ["preference", "prefer"],
  dislikes: ["avoid", "no", "dont"],
  device: ["toy", "intiface", "inventory"],
};

function expandQueryTokens(tokens: Set<string>): Set<string> {
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    const related = TOKEN_EXPANSIONS[token] ?? [];
    for (const alias of related) {
      expanded.add(alias);
    }
  }
  return expanded;
}

function computeRecencyBoost(updatedAt: string): number {
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const ageMs = Math.max(0, Date.now() - parsed);
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours <= 1) {
    return 1.5;
  }
  if (ageHours <= 24) {
    return 1;
  }
  if (ageHours <= 24 * 7) {
    return 0.6;
  }
  if (ageHours <= 24 * 30) {
    return 0.3;
  }
  return 0;
}

function computeReinforcementBoost(memory: LongTermMemoryRow): number {
  const reinforcementCount = Math.max(0, Math.floor(memory.reinforcement_count || 0));
  return Math.min(reinforcementCount, 8) * 0.35;
}

function compareMemoryPriority(left: LongTermMemoryRow, right: LongTermMemoryRow): number {
  if (left.is_pinned !== right.is_pinned) {
    return left.is_pinned ? -1 : 1;
  }
  if (left.reinforcement_count !== right.reinforcement_count) {
    return right.reinforcement_count - left.reinforcement_count;
  }
  if (left.last_recalled_at && right.last_recalled_at && left.last_recalled_at !== right.last_recalled_at) {
    return right.last_recalled_at.localeCompare(left.last_recalled_at);
  }
  return right.updated_at.localeCompare(left.updated_at);
}

function scoreMemory(memory: LongTermMemoryRow, queryTokens: Set<string>): number {
  const baseWeight =
    memory.confidence * 0.45 + memory.importance * 0.35 + memory.stability * 0.2;
  const recencyBoost = computeRecencyBoost(memory.updated_at);
  const reinforcementBoost = computeReinforcementBoost(memory);
  const pinnedBoost = memory.is_pinned ? 8 : 0;
  if (queryTokens.size === 0) {
    return baseWeight + recencyBoost + reinforcementBoost + pinnedBoost;
  }

  let score = baseWeight + recencyBoost + reinforcementBoost + pinnedBoost;
  const keyTokens = tokenize(memory.key);
  const valueTokens = tokenize(memory.value);
  const tagTokens = new Set(memory.tags);

  for (const token of queryTokens) {
    if (keyTokens.has(token)) {
      score += 4;
    }
    if (valueTokens.has(token)) {
      score += 2;
    }
    if (tagTokens.has(token)) {
      score += 3;
    }
  }
  return score;
}

export function selectRelevantMemories(
  memories: LongTermMemoryRow[],
  query: string,
  limit = 12,
): LongTermMemoryRow[] {
  const queryTokens = expandQueryTokens(tokenize(query));
  const activeMemories = memories.filter((memory) => memory.is_active !== false);
  const pinnedMemories = activeMemories
    .filter((memory) => memory.is_pinned)
    .sort((left, right) => {
      const scoreDelta = scoreMemory(right, queryTokens) - scoreMemory(left, queryTokens);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return compareMemoryPriority(left, right);
    });
  const ranked = activeMemories
    .filter((memory) => !memory.is_pinned)
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, queryTokens),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.memory.updated_at.localeCompare(a.memory.updated_at);
    });

  const seenKeys = new Set<string>();
  const picked: LongTermMemoryRow[] = [];
  for (const memory of pinnedMemories) {
    if (picked.length >= limit) {
      break;
    }
    seenKeys.add(memory.key);
    picked.push(memory);
  }
  for (const item of ranked) {
    if (seenKeys.has(item.memory.key) && picked.length >= Math.ceil(limit / 2)) {
      continue;
    }
    seenKeys.add(item.memory.key);
    picked.push(item.memory);
    if (picked.length >= limit) {
      break;
    }
  }
  return picked;
}

export function buildPinnedMemoryBlock(input: {
  memories: LongTermMemoryRow[];
  maxLines?: number;
}): string | null {
  const maxLines = Math.max(2, Math.min(8, input.maxLines ?? 6));
  const pinned = input.memories
    .filter((memory) => memory.is_active !== false && memory.is_pinned)
    .sort(compareMemoryPriority)
    .slice(0, Math.max(1, maxLines - 1));

  if (pinned.length === 0) {
    return null;
  }

  const lines = pinned.map((memory) => `- ${memory.key}: ${memory.value}`.slice(0, 220));
  return ["Fixed memory:", ...lines].join("\n");
}

export function buildMemoryInjectionBlock(input: {
  memories: LongTermMemoryRow[];
  lastSessionSummary: string | null;
  maxLines?: number;
}): string {
  const maxLines = Math.max(4, Math.min(14, input.maxLines ?? 10));
  const lines: string[] = [];
  const byType = {
    goal: [] as string[],
    constraint: [] as string[],
    preference: [] as string[],
    setup: [] as string[],
    habit: [] as string[],
    misc: [] as string[],
  };

  for (const memory of input.memories) {
    if (memory.is_active === false || memory.is_pinned) {
      continue;
    }
    const target = byType[memory.type] ?? byType.misc;
    target.push(`${memory.key}: ${memory.value}`.slice(0, 180));
  }

  const pushTypeLine = (label: string, values: string[]) => {
    if (values.length === 0) {
      return;
    }
    lines.push(`- ${label}: ${values.slice(0, 2).join(" | ")}`.slice(0, 220));
  };

  pushTypeLine("goal", byType.goal);
  pushTypeLine("constraints", byType.constraint);
  pushTypeLine("preferences", byType.preference);
  pushTypeLine("setup", byType.setup);
  pushTypeLine("habit", byType.habit);
  pushTypeLine("misc", byType.misc);

  if (input.lastSessionSummary && lines.length < maxLines - 1) {
    lines.push(`- last_session_summary: ${input.lastSessionSummary}`.slice(0, 220));
  }
  if (lines.length === 0) {
    lines.push("- none");
  }
  return ["Memory:", ...lines.slice(0, Math.max(1, maxLines - 1))].join("\n");
}

function pickTopValues(memories: LongTermMemoryRow[], type: LongTermMemoryRow["type"], limit: number): string[] {
  return memories
    .filter((memory) => memory.is_active !== false && memory.type === type)
    .sort(compareMemoryPriority)
    .slice(0, limit)
    .map((memory) => `${memory.key}: ${memory.value}`.slice(0, 180));
}

function derivePowerPreference(memories: LongTermMemoryRow[]): string | null {
  const joined = memories
    .filter((memory) => memory.is_active !== false)
    .flatMap((memory) => [memory.key, memory.value, ...memory.tags])
    .join(" ")
    .toLowerCase();
  if (!joined) {
    return null;
  }
  if (/\b(strict|firm|dominant|control|obedience|chastity|discipline)\b/.test(joined)) {
    return "User responds best to firm control, clear rules, and confident direction.";
  }
  if (/\b(gentle|warm|soft|slow)\b/.test(joined)) {
    return "User responds better to steadier pacing and a more measured dominant tone.";
  }
  return null;
}

export function buildLearnedUserProfileBlock(input: {
  memories: LongTermMemoryRow[];
  lastSessionSummary: string | null;
  maxLines?: number;
}): string {
  const maxLines = Math.max(4, Math.min(12, input.maxLines ?? 8));
  const lines: string[] = [];
  const goals = pickTopValues(input.memories, "goal", 1);
  const preferences = pickTopValues(input.memories, "preference", 2);
  const constraints = pickTopValues(input.memories, "constraint", 2);
  const habits = pickTopValues(input.memories, "habit", 1);
  const setup = pickTopValues(input.memories, "setup", 1);
  const powerPreference = derivePowerPreference(input.memories);

  if (goals.length > 0) {
    lines.push(`- focus: ${goals.join(" | ")}`.slice(0, 220));
  }
  if (preferences.length > 0) {
    lines.push(`- wants: ${preferences.join(" | ")}`.slice(0, 220));
  }
  if (constraints.length > 0) {
    lines.push(`- avoid: ${constraints.join(" | ")}`.slice(0, 220));
  }
  if (habits.length > 0) {
    lines.push(`- recurring pattern: ${habits.join(" | ")}`.slice(0, 220));
  }
  if (setup.length > 0) {
    lines.push(`- setup cue: ${setup.join(" | ")}`.slice(0, 220));
  }
  if (powerPreference) {
    lines.push(`- power dynamic: ${powerPreference}`.slice(0, 220));
  }
  if (input.lastSessionSummary && lines.length < maxLines - 1) {
    lines.push(`- recent arc: ${input.lastSessionSummary}`.slice(0, 220));
  }
  if (lines.length === 0) {
    lines.push("- none");
  }

  return ["Learned user profile:", ...lines.slice(0, Math.max(1, maxLines - 1))].join("\n");
}
