"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { stopRavenSpeech } from "@/lib/speech";

type EmergencyStopContextValue = {
  stopped: boolean;
  setStopped: (nextValue: boolean) => Promise<void>;
  loading: boolean;
};

const EmergencyStopContext = createContext<EmergencyStopContextValue | undefined>(undefined);
const STOPPED_STORAGE_KEY = "raven.emergency_stopped";

export function EmergencyStopProvider({ children }: { children: ReactNode }) {
  const [stopped, setStoppedState] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(STOPPED_STORAGE_KEY) === "true";
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/emergency-stop")
      .then((response) => response.json() as Promise<{ stopped: boolean }>)
      .then((body) => {
        setStoppedState(body.stopped);
        window.localStorage.setItem(STOPPED_STORAGE_KEY, String(body.stopped));
      })
      .catch(() => {
        // Keep local state fallback when API is temporarily unavailable.
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!stopped) {
      return;
    }
    stopRavenSpeech();
  }, [stopped]);

  const setStopped = useCallback(async (nextValue: boolean) => {
    const response = await fetch("/api/emergency-stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopped: nextValue }),
    });

    if (!response.ok) {
      throw new Error("Failed to update emergency stop state.");
    }

    const body = (await response.json()) as { stopped: boolean };
    setStoppedState(body.stopped);
    window.localStorage.setItem(STOPPED_STORAGE_KEY, String(body.stopped));
  }, []);

  const value = useMemo(
    () => ({
      stopped,
      setStopped,
      loading,
    }),
    [stopped, setStopped, loading],
  );

  return <EmergencyStopContext.Provider value={value}>{children}</EmergencyStopContext.Provider>;
}

export function useEmergencyStop() {
  const context = useContext(EmergencyStopContext);
  if (!context) {
    throw new Error("useEmergencyStop must be used inside EmergencyStopProvider.");
  }

  return context;
}
