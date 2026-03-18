export type MemoryCommand =
  | { type: "remember"; text: string }
  | { type: "forget"; text: string }
  | { type: "forget_confirm"; text: string }
  | { type: "show" };

export function parseMemoryCommand(input: string): MemoryCommand | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === "show memories" || lowered === "show memory") {
    return { type: "show" };
  }

  const rememberPrefix = trimmed.match(/^remember:\s*(.+)$/i);
  if (rememberPrefix?.[1]) {
    return { type: "remember", text: rememberPrefix[1].trim() };
  }

  const forgetPrefix = trimmed.match(/^forget:\s*(.+)$/i);
  if (forgetPrefix?.[1]) {
    return { type: "forget", text: forgetPrefix[1].trim() };
  }

  const forgetConfirmPrefix = trimmed.match(/^forget\s+confirm:\s*(.+)$/i);
  if (forgetConfirmPrefix?.[1]) {
    return { type: "forget_confirm", text: forgetConfirmPrefix[1].trim() };
  }

  const rememberNatural = trimmed.match(/^remember\s+that\s+(.+)$/i);
  if (rememberNatural?.[1]) {
    return { type: "remember", text: rememberNatural[1].trim() };
  }

  const forgetNatural = trimmed.match(/^forget\s+(.+)$/i);
  if (forgetNatural?.[1]) {
    const query = forgetNatural[1].trim().replace(/^my\s+/i, "");
    return { type: "forget", text: query };
  }

  return null;
}
