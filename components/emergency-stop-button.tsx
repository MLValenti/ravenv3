"use client";

import { useState } from "react";

import { useEmergencyStop } from "@/components/emergency-stop-provider";

export function EmergencyStopButton() {
  const { stopped, setStopped, loading } = useEmergencyStop();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = loading || updating;

  async function onClick() {
    setError(null);
    setUpdating(true);
    try {
      await setStopped(!stopped);
    } catch {
      setError("Unable to update emergency stop state.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="stop-control">
      <button
        type="button"
        className={stopped ? "button button-danger" : "button"}
        onClick={onClick}
        disabled={disabled}
      >
        {disabled ? "Updating..." : stopped ? "Release Emergency Stop" : "Engage Emergency Stop"}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
