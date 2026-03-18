"use client";

import type { CameraEvent } from "./camera/events";

export type RuntimeEvent =
  | {
      type: "camera.event";
      timestamp: number;
      event: CameraEvent;
    }
  | {
      type: "raven.output";
      timestamp: number;
      source: "chat" | "session";
      text: string;
    };

type EventHandler = (event: RuntimeEvent) => void;

const CHANNEL_NAME = "raven-runtime-events";
const LOCAL_EVENT_NAME = "raven-runtime-event";

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof window.BroadcastChannel === "undefined") {
    return null;
  }

  const key = "__raven_runtime_channel__";
  const existing = (window as unknown as Record<string, unknown>)[key];
  if (existing instanceof BroadcastChannel) {
    return existing;
  }

  const created = new BroadcastChannel(CHANNEL_NAME);
  (window as unknown as Record<string, unknown>)[key] = created;
  return created;
}

export function publishRuntimeEvent(event: RuntimeEvent): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<RuntimeEvent>(LOCAL_EVENT_NAME, { detail: event }));
  const channel = getBroadcastChannel();
  if (channel) {
    channel.postMessage(event);
  }
}

export function subscribeRuntimeEvents(handler: EventHandler): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const localListener = (event: Event) => {
    const custom = event as CustomEvent<RuntimeEvent>;
    handler(custom.detail);
  };
  window.addEventListener(LOCAL_EVENT_NAME, localListener);

  const channel = getBroadcastChannel();
  const channelListener = (event: MessageEvent<RuntimeEvent>) => {
    handler(event.data);
  };
  if (channel) {
    channel.addEventListener("message", channelListener);
  }

  return () => {
    window.removeEventListener(LOCAL_EVENT_NAME, localListener);
    if (channel) {
      channel.removeEventListener("message", channelListener);
    }
  };
}
