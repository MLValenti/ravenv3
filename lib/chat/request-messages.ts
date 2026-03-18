export type ClientDialogueMessage = {
  role: "user" | "assistant";
  content: string;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function buildClientChatMessages(
  history: ClientDialogueMessage[],
  latestUserText: string,
  maxMessages = 20,
): ClientDialogueMessage[] {
  const limited = history.slice(-maxMessages);
  const normalizedLatest = normalize(latestUserText).toLowerCase();
  if (limited.length === 0 || !normalizedLatest) {
    return normalizedLatest
      ? [...limited, { role: "user", content: normalize(latestUserText) }]
      : limited;
  }

  const last = limited[limited.length - 1];
  const withoutDuplicateLatest =
    last && last.role === "user" && normalize(last.content).toLowerCase() === normalizedLatest
      ? limited.slice(0, -1)
      : limited;

  return [...withoutDuplicateLatest, { role: "user", content: normalize(latestUserText) }];
}

export function stripClientPromptScaffolding<
  T extends { role: "user" | "assistant" | "system"; content: string },
>(messages: T[]): T[] {
  return messages.filter((message) => message.role !== "system");
}
