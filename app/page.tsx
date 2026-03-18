"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useEmergencyStop } from "@/components/emergency-stop-provider";
import { DEFAULT_SETTINGS, loadSettingsFromStorage, type SettingsState } from "@/lib/settings";

type OperatorServiceState = {
  state: "online" | "offline" | "disabled" | "skipped";
  url: string;
  detail: string;
  latencyMs: number | null;
  httpStatus: number | null;
};

type StatusResponse = {
  app: {
    name: string;
    version: string;
    uptimeSeconds: number;
    now: string;
  };
  emergencyStop: {
    stopped: boolean;
    reason: string | null;
    updatedAt: string;
  };
  devices: {
    connected: boolean;
    scanning: boolean;
    url: string;
    last_error: string | null;
    device_count: number;
  };
  tasks: {
    activeCount: number;
    pendingOccurrenceCount: number;
    pendingReviewCount: number;
    totalPoints: number;
    currentTier: string;
  };
  memory: {
    pendingSuggestionCount: number;
  };
  services: {
    ollama: OperatorServiceState;
    piper: OperatorServiceState;
  };
  config: {
    ollamaUrl: string;
    piperUrl: string;
    ttsProvider: "browser" | "piper";
  };
};

function formatServiceState(service: OperatorServiceState): string {
  if (service.state === "online") {
    return "ONLINE";
  }
  if (service.state === "disabled") {
    return "DISABLED";
  }
  if (service.state === "skipped") {
    return "SKIPPED";
  }
  return "OFFLINE";
}

function formatLastUpdated(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export default function HomePage() {
  const { stopped, loading: stopLoading } = useEmergencyStop();
  const [settings, setSettings] = useState<SettingsState>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SETTINGS;
    }
    return loadSettingsFromStorage(window.localStorage);
  });
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus(nextSettings: SettingsState, silent = false) {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const query = new URLSearchParams({
        ollamaUrl: nextSettings.ollamaBaseUrl,
        piperUrl: nextSettings.piperUrl,
        ttsProvider: nextSettings.ttsProvider,
      });
      const response = await fetch(`/api/status?${query.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as Partial<StatusResponse> & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load operator status.");
      }
      setStatus(body as StatusResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load operator status.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextSettings = loadSettingsFromStorage(window.localStorage);
    setSettings(nextSettings);
    void refreshStatus(nextSettings);

    const intervalId = window.setInterval(() => {
      const latestSettings = loadSettingsFromStorage(window.localStorage);
      setSettings(latestSettings);
      void refreshStatus(latestSettings, true);
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const latestSettings = loadSettingsFromStorage(window.localStorage);
    setSettings(latestSettings);
    void refreshStatus(latestSettings, true);
  }, [stopped]);

  return (
    <section className="panel operator-panel">
      <div className="operator-header">
        <div>
          <p className="eyebrow">Local Operator Console</p>
          <h1>Raven Runtime</h1>
          <p className="muted">
            Local-only status for safety, services, queues, and session support systems.
          </p>
        </div>
        <div className="camera-controls">
          <Link className="button button-secondary" href="/settings">
            Open Settings
          </Link>
          <Link className="button button-secondary" href="/session">
            Open Session
          </Link>
          <button
            className="button button-secondary"
            type="button"
            disabled={loading || refreshing}
            onClick={() => void refreshStatus(settings, true)}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="status-grid">
        <div className="card status-card">
          <span className="pill-label">Emergency Stop</span>
          {stopLoading ? (
            <strong>Loading...</strong>
          ) : (
            <strong className={stopped ? "danger-text" : "ok-text"}>
              {stopped ? "ENGAGED" : "CLEAR"}
            </strong>
          )}
          <p className="muted">
            {status
              ? `Last change: ${formatLastUpdated(status.emergencyStop.updatedAt)}`
              : "No server state yet."}
          </p>
        </div>
        <div className="card status-card">
          <span className="pill-label">Ollama</span>
          <strong
            className={status?.services.ollama.state === "online" ? "ok-text" : "danger-text"}
          >
            {status ? formatServiceState(status.services.ollama) : "UNKNOWN"}
          </strong>
          <p className="muted">{status?.services.ollama.detail ?? settings.ollamaBaseUrl}</p>
        </div>
        <div className="card status-card">
          <span className="pill-label">Piper</span>
          <strong
            className={
              status?.services.piper.state === "online"
                ? "ok-text"
                : status?.services.piper.state === "disabled"
                  ? ""
                  : "danger-text"
            }
          >
            {status ? formatServiceState(status.services.piper) : "UNKNOWN"}
          </strong>
          <p className="muted">{status?.services.piper.detail ?? settings.piperUrl}</p>
        </div>
        <div className="card status-card">
          <span className="pill-label">Devices</span>
          <strong className={status?.devices.connected ? "ok-text" : ""}>
            {status?.devices.connected ? "CONNECTED" : "DISCONNECTED"}
          </strong>
          <p className="muted">
            {status
              ? `${status.devices.device_count} device${status.devices.device_count === 1 ? "" : "s"} visible`
              : "No device status yet."}
          </p>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p>Loading local subsystem status...</p> : null}

      <div className="operator-grid">
        <div className="card">
          <h2>Runtime</h2>
          {status ? (
            <div className="stack-list">
              <p>
                <strong>{status.app.name}</strong> v{status.app.version}
              </p>
              <p className="muted">Uptime: {formatUptime(status.app.uptimeSeconds)}</p>
              <p className="muted">Now: {formatLastUpdated(status.app.now)}</p>
              <p className="muted">Stop reason: {status.emergencyStop.reason ?? "none"}</p>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>Queues</h2>
          {status ? (
            <div className="stack-list">
              <p>
                Active tasks: <strong>{status.tasks.activeCount}</strong>
              </p>
              <p>
                Pending occurrences: <strong>{status.tasks.pendingOccurrenceCount}</strong>
              </p>
              <p>
                Pending review: <strong>{status.tasks.pendingReviewCount}</strong>
              </p>
              <p>
                Pending memory suggestions: <strong>{status.memory.pendingSuggestionCount}</strong>
              </p>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>Progress</h2>
          {status ? (
            <div className="stack-list">
              <p>
                Tier: <strong>{status.tasks.currentTier}</strong>
              </p>
              <p>
                Total points: <strong>{status.tasks.totalPoints}</strong>
              </p>
              <p className="muted">
                Use `/review`, `/tasks`, and `/profile` to clear queues before new session work.
              </p>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>Local Config</h2>
          <div className="stack-list">
            <p className="muted">Ollama: {settings.ollamaBaseUrl}</p>
            <p className="muted">Model: {settings.ollamaModel}</p>
            <p className="muted">TTS: {settings.ttsProvider}</p>
            <p className="muted">Piper: {settings.piperUrl}</p>
            <p className="muted">Intiface: {settings.intifaceWsUrl}</p>
          </div>
        </div>
      </div>

      <div className="operator-grid">
        <div className="card">
          <h2>Service Detail</h2>
          {status ? (
            <div className="stack-list">
              <p>
                Ollama: <strong>{formatServiceState(status.services.ollama)}</strong>
              </p>
              <p className="muted">{status.services.ollama.url}</p>
              <p className="muted">{status.services.ollama.detail}</p>
              <p className="muted">
                Latency:{" "}
                {status.services.ollama.latencyMs == null
                  ? "n/a"
                  : `${status.services.ollama.latencyMs} ms`}
              </p>
              <p>
                Piper: <strong>{formatServiceState(status.services.piper)}</strong>
              </p>
              <p className="muted">{status.services.piper.url}</p>
              <p className="muted">{status.services.piper.detail}</p>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>Device Detail</h2>
          {status ? (
            <div className="stack-list">
              <p className="muted">URL: {status.devices.url}</p>
              <p className="muted">Scanning: {status.devices.scanning ? "yes" : "no"}</p>
              <p className="muted">Last error: {status.devices.last_error ?? "none"}</p>
              <p className="muted">
                Device commands still require explicit opt-in and remain blocked by the emergency
                stop.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
