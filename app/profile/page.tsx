"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { PROFILE_STORAGE_KEY, type ProfileState, loadProfileFromStorage, normalizeProfileInput } from "@/lib/profile";

type MemoryType = "preference" | "goal" | "constraint" | "setup" | "habit" | "misc";

type MemoryRow = {
  id: string;
  key: string;
  value: string;
  type: MemoryType;
  tags: string[];
  importance: number;
  stability: number;
  confidence: number;
  is_active: boolean;
  is_pinned: boolean;
  reinforcement_count: number;
};

type MemorySuggestionRow = {
  id: string;
  key: string;
  value: string;
  type: MemoryType;
  tags: string[];
  importance: number;
  stability: number;
  confidence: number;
  suggestion_kind: "new" | "update";
  status: "pending" | "approved" | "rejected";
};

type MemoryPreferences = {
  auto_save: boolean;
  auto_save_goals: boolean;
  auto_save_constraints: boolean;
  auto_save_preferences: boolean;
  suggestion_snooze_until: string | null;
};

type MemoryResponse = {
  memories?: MemoryRow[];
  suggestions?: MemorySuggestionRow[];
  preferences?: MemoryPreferences;
  error?: string;
};

type MemoryDraft = {
  key: string;
  value: string;
  type: MemoryType;
  tags: string;
  is_active: boolean;
  is_pinned: boolean;
};

type SuggestionDraft = {
  key: string;
  value: string;
  type: MemoryType;
  tags: string;
  is_pinned: boolean;
  user_feedback: string;
};

const DEFAULT_MEMORY_PREFERENCES: MemoryPreferences = {
  auto_save: false,
  auto_save_goals: true,
  auto_save_constraints: false,
  auto_save_preferences: false,
  suggestion_snooze_until: null,
};

const MEMORY_TYPE_OPTIONS: MemoryType[] = [
  "goal",
  "constraint",
  "preference",
  "setup",
  "habit",
  "misc",
];

function parseTagsInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 24);
}

function normalizeMemoryType(value: unknown): MemoryType {
  if (
    value === "preference" ||
    value === "goal" ||
    value === "constraint" ||
    value === "setup" ||
    value === "habit" ||
    value === "misc"
  ) {
    return value;
  }
  return "misc";
}

function normalizePreferences(value: unknown): MemoryPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_MEMORY_PREFERENCES;
  }
  const row = value as Partial<MemoryPreferences>;
  return {
    auto_save: row.auto_save === true,
    auto_save_goals: row.auto_save_goals !== false,
    auto_save_constraints: row.auto_save_constraints === true,
    auto_save_preferences: row.auto_save_preferences === true,
    suggestion_snooze_until:
      typeof row.suggestion_snooze_until === "string" ? row.suggestion_snooze_until : null,
  };
}

function toIsoInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileState>(() =>
    typeof window === "undefined" ? {} : loadProfileFromStorage(window.localStorage),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [suggestions, setSuggestions] = useState<MemorySuggestionRow[]>([]);
  const [preferences, setPreferences] = useState<MemoryPreferences>(DEFAULT_MEMORY_PREFERENCES);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, MemoryDraft>>({});
  const [suggestionDrafts, setSuggestionDrafts] = useState<Record<string, SuggestionDraft>>({});
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memorySaving, setMemorySaving] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [createValue, setCreateValue] = useState("");
  const [createType, setCreateType] = useState<MemoryType>("misc");
  const [createTags, setCreateTags] = useState("");
  const [createPinned, setCreatePinned] = useState(false);
  const [forgetQuery, setForgetQuery] = useState("");

  const snoozedUntilText = useMemo(() => {
    if (!preferences.suggestion_snooze_until) {
      return null;
    }
    const when = Date.parse(preferences.suggestion_snooze_until);
    if (!Number.isFinite(when) || when <= Date.now()) {
      return null;
    }
    return new Date(when).toLocaleString();
  }, [preferences.suggestion_snooze_until]);

  const pendingCount = suggestions.length;

  useEffect(() => {
    void fetch("/api/profile")
      .then((response) => response.json() as Promise<{ profile?: unknown }>)
      .then((body) => {
        const normalized = normalizeProfileInput(body.profile);
        setProfile(normalized);
        window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
      })
      .catch(() => {
        // keep local profile fallback
      })
      .finally(() => setLoading(false));
  }, []);

  const applyMemoryPayload = useCallback((payload: MemoryResponse) => {
    const nextMemories = Array.isArray(payload.memories) ? payload.memories : [];
    const nextSuggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
    const nextPreferences = normalizePreferences(payload.preferences);

    setMemories(nextMemories);
    setSuggestions(nextSuggestions);
    setPreferences(nextPreferences);

    setMemoryDrafts((current) => {
      const next: Record<string, MemoryDraft> = {};
      for (const memory of nextMemories) {
        const existing = current[memory.id];
        next[memory.id] = existing ?? {
          key: memory.key,
          value: memory.value,
          type: normalizeMemoryType(memory.type),
          tags: memory.tags.join(", "),
          is_active: memory.is_active !== false,
          is_pinned: memory.is_pinned === true,
        };
      }
      return next;
    });

    setSuggestionDrafts((current) => {
      const next: Record<string, SuggestionDraft> = {};
      for (const suggestion of nextSuggestions) {
        const existing = current[suggestion.id];
        next[suggestion.id] = existing ?? {
          key: suggestion.key,
          value: suggestion.value,
          type: normalizeMemoryType(suggestion.type),
          tags: suggestion.tags.join(", "),
          is_pinned: false,
          user_feedback: "",
        };
      }
      return next;
    });
  }, []);

  const refreshMemories = useCallback(async () => {
    const response = await fetch("/api/memory", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as MemoryResponse;
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to load memories.");
    }
    applyMemoryPayload(body);
  }, [applyMemoryPayload]);

  async function runMemoryAction(payload: Record<string, unknown>) {
    setMemoryError(null);
    setMemorySaving(true);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as MemoryResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Memory action failed.");
      }
      applyMemoryPayload(body);
    } catch (actionError) {
      setMemoryError(actionError instanceof Error ? actionError.message : "Memory action failed.");
    } finally {
      setMemorySaving(false);
    }
  }

  useEffect(() => {
    void refreshMemories().catch((loadError) => {
      setMemoryError(loadError instanceof Error ? loadError.message : "Failed to load memories.");
    });
  }, [refreshMemories]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    const payload = normalizeProfileInput(profile);
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setError("Unable to save profile.");
      setSaving(false);
      return;
    }

    const body = (await response.json()) as { profile?: unknown };
    const normalized = normalizeProfileInput(body.profile);
    setProfile(normalized);
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  function updateMemoryDraft(id: string, patch: Partial<MemoryDraft>) {
    setMemoryDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          key: "",
          value: "",
          type: "misc",
          tags: "",
          is_active: true,
          is_pinned: false,
        }),
        ...patch,
      },
    }));
  }

  function updateSuggestionDraft(id: string, patch: Partial<SuggestionDraft>) {
    setSuggestionDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          key: "",
          value: "",
          type: "misc",
          tags: "",
          is_pinned: false,
          user_feedback: "",
        }),
        ...patch,
      },
    }));
  }

  async function updatePreferences(patch: Partial<MemoryPreferences>) {
    await runMemoryAction({
      action: "set_preferences",
      ...patch,
    });
  }

  return (
    <section className="panel">
      <h1>Profile</h1>
      <p className="muted">Edit memory facts used by Raven.</p>

      {loading ? <p className="muted">Loading profile...</p> : null}

      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>Safeword</span>
          <input
            value={profile.safeword ?? ""}
            onChange={(event) => setProfile((current) => ({ ...current, safeword: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Limits</span>
          <textarea
            rows={4}
            value={profile.limits ?? ""}
            onChange={(event) => setProfile((current) => ({ ...current, limits: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Intensity</span>
          <input
            value={profile.intensity ?? ""}
            onChange={(event) => setProfile((current) => ({ ...current, intensity: event.target.value }))}
            placeholder="low / medium / high"
          />
        </label>

        <label className="field">
          <span>Preferred style</span>
          <input
            value={profile.preferred_style ?? ""}
            onChange={(event) =>
              setProfile((current) => ({ ...current, preferred_style: event.target.value }))
            }
          />
        </label>

        <button className="button" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </form>

      {saved ? <p className="ok-text">Saved</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>
          Memory Panel <span className="muted">({pendingCount} pending)</span>
        </h2>
        <p className="muted">
          Commands in session: remember: &lt;text&gt;, forget: &lt;key or phrase&gt;, show memories.
        </p>

        <label className="field-checkbox" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={preferences.auto_save}
            disabled={memorySaving}
            onChange={(event) => {
              void updatePreferences({ auto_save: event.target.checked });
            }}
          />
          <span>Auto approve suggestions</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={preferences.auto_save_goals}
            disabled={memorySaving}
            onChange={(event) => {
              void updatePreferences({ auto_save_goals: event.target.checked });
            }}
          />
          <span>Auto approve goals</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={preferences.auto_save_constraints}
            disabled={memorySaving}
            onChange={(event) => {
              void updatePreferences({ auto_save_constraints: event.target.checked });
            }}
          />
          <span>Auto approve constraints</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={preferences.auto_save_preferences}
            disabled={memorySaving}
            onChange={(event) => {
              void updatePreferences({ auto_save_preferences: event.target.checked });
            }}
          />
          <span>Auto approve preferences</span>
        </label>

        <div className="camera-controls" style={{ marginTop: 8 }}>
          <button
            className="button button-secondary"
            type="button"
            disabled={memorySaving}
            onClick={() => {
              void updatePreferences({ suggestion_snooze_until: toIsoInHours(2) });
            }}
          >
            Snooze suggestions (session)
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={memorySaving}
            onClick={() => {
              void updatePreferences({ suggestion_snooze_until: toIsoInHours(24) });
            }}
          >
            Snooze suggestions (24h)
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={memorySaving}
            onClick={() => {
              void updatePreferences({ suggestion_snooze_until: null });
            }}
          >
            Resume suggestions
          </button>
        </div>
        {snoozedUntilText ? <p className="muted">Suggestions snoozed until {snoozedUntilText}</p> : null}

        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!createKey.trim() || !createValue.trim()) {
              setMemoryError("Memory key and value are required.");
              return;
            }
            void runMemoryAction({
              action: "create",
              key: createKey.trim(),
              value: createValue.trim(),
              type: createType,
              tags: parseTagsInput(createTags),
              is_pinned: createPinned,
            }).then(() => {
              setCreateKey("");
              setCreateValue("");
              setCreateType("misc");
              setCreateTags("");
              setCreatePinned(false);
            });
          }}
        >
          <label className="field">
            <span>Add memory key</span>
            <input value={createKey} onChange={(event) => setCreateKey(event.target.value)} />
          </label>
          <label className="field">
            <span>Add memory value</span>
            <input value={createValue} onChange={(event) => setCreateValue(event.target.value)} />
          </label>
          <label className="field">
            <span>Type</span>
            <select value={createType} onChange={(event) => setCreateType(normalizeMemoryType(event.target.value))}>
              {MEMORY_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Tags (comma separated)</span>
            <input value={createTags} onChange={(event) => setCreateTags(event.target.value)} />
          </label>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={createPinned}
              onChange={(event) => setCreatePinned(event.target.checked)}
            />
            <span>Pin as fixed memory</span>
          </label>
          <button className="button" type="submit" disabled={memorySaving}>
            Add Memory
          </button>
        </form>

        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!forgetQuery.trim()) {
              setMemoryError("Enter key text or phrase to forget.");
              return;
            }
            void runMemoryAction({ action: "forget", query: forgetQuery.trim() }).then(() => {
              setForgetQuery("");
            });
          }}
        >
          <label className="field">
            <span>Forget by key or phrase</span>
            <input
              value={forgetQuery}
              onChange={(event) => setForgetQuery(event.target.value)}
              placeholder="goal or specific phrase"
            />
          </label>
          <button className="button button-secondary" type="submit" disabled={memorySaving}>
            Forget Match
          </button>
        </form>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <h3>Saved Memories</h3>
          {memories.length === 0 ? <p className="muted">No saved memories yet.</p> : null}
          {memories.map((memory) => {
            const draft = memoryDrafts[memory.id] ?? {
              key: memory.key,
              value: memory.value,
              type: memory.type,
              tags: memory.tags.join(", "),
              is_active: memory.is_active !== false,
              is_pinned: memory.is_pinned === true,
            };
            return (
              <article key={memory.id} className="card">
                <label className="field">
                  <span>Key</span>
                  <input
                    value={draft.key}
                    onChange={(event) => updateMemoryDraft(memory.id, { key: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Value</span>
                  <textarea
                    rows={3}
                    value={draft.value}
                    onChange={(event) => updateMemoryDraft(memory.id, { value: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Type</span>
                  <select
                    value={draft.type}
                    onChange={(event) =>
                      updateMemoryDraft(memory.id, { type: normalizeMemoryType(event.target.value) })
                    }
                  >
                    {MEMORY_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Tags</span>
                  <input
                    value={draft.tags}
                    onChange={(event) => updateMemoryDraft(memory.id, { tags: event.target.value })}
                  />
                </label>
                <label className="field-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(event) =>
                      updateMemoryDraft(memory.id, { is_active: event.target.checked })
                    }
                  />
                  <span>Active</span>
                </label>
                <label className="field-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.is_pinned}
                    onChange={(event) =>
                      updateMemoryDraft(memory.id, { is_pinned: event.target.checked })
                    }
                  />
                  <span>Pinned / fixed</span>
                </label>
                <p className="muted">
                  Type={memory.type} confidence={memory.confidence.toFixed(2)} importance=
                  {memory.importance.toFixed(2)} stability={memory.stability.toFixed(2)} recalls=
                  {memory.reinforcement_count}
                </p>
                <div className="camera-controls">
                  <button
                    className="button"
                    type="button"
                    disabled={memorySaving}
                    onClick={() =>
                      void runMemoryAction({
                        action: "update",
                        id: memory.id,
                        key: draft.key,
                        value: draft.value,
                        type: draft.type,
                        tags: parseTagsInput(draft.tags),
                        is_active: draft.is_active,
                        is_pinned: draft.is_pinned,
                      })
                    }
                  >
                    Save Memory
                  </button>
                  <button
                    className="button button-danger"
                    type="button"
                    disabled={memorySaving}
                    onClick={() => void runMemoryAction({ action: "delete", id: memory.id })}
                  >
                    Delete Memory
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div style={{ marginTop: 12 }}>
          <h3>
            Pending Suggestions <span className="muted">({pendingCount})</span>
          </h3>
          {suggestions.length === 0 ? <p className="muted">No pending suggestions.</p> : null}
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            {suggestions.map((suggestion) => {
                const draft = suggestionDrafts[suggestion.id] ?? {
                  key: suggestion.key,
                  value: suggestion.value,
                  type: suggestion.type,
                  tags: suggestion.tags.join(", "),
                  is_pinned: false,
                  user_feedback: "",
                };
              return (
                <article key={suggestion.id} className="card">
                  <p className="muted">
                    kind={suggestion.suggestion_kind} confidence={suggestion.confidence.toFixed(2)} importance=
                    {suggestion.importance.toFixed(2)} stability={suggestion.stability.toFixed(2)}
                  </p>
                  <label className="field">
                    <span>Key</span>
                    <input
                      value={draft.key}
                      onChange={(event) =>
                        updateSuggestionDraft(suggestion.id, { key: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Value</span>
                    <textarea
                      rows={3}
                      value={draft.value}
                      onChange={(event) =>
                        updateSuggestionDraft(suggestion.id, { value: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Type</span>
                    <select
                      value={draft.type}
                      onChange={(event) =>
                        updateSuggestionDraft(suggestion.id, {
                          type: normalizeMemoryType(event.target.value),
                        })
                      }
                    >
                      {MEMORY_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Tags</span>
                    <input
                      value={draft.tags}
                      onChange={(event) =>
                        updateSuggestionDraft(suggestion.id, { tags: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>User feedback (optional)</span>
                    <input
                      value={draft.user_feedback}
                      onChange={(event) =>
                        updateSuggestionDraft(suggestion.id, { user_feedback: event.target.value })
                      }
                    />
                  </label>
                  <label className="field-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.is_pinned}
                      onChange={(event) =>
                        updateSuggestionDraft(suggestion.id, { is_pinned: event.target.checked })
                      }
                    />
                    <span>Approve as fixed memory</span>
                  </label>
                  <div className="camera-controls">
                    <button
                      className="button"
                      type="button"
                      disabled={memorySaving}
                      onClick={() =>
                        void runMemoryAction({
                          action: "approve_suggestion",
                          id: suggestion.id,
                          key: draft.key,
                          value: draft.value,
                          type: draft.type,
                          tags: parseTagsInput(draft.tags),
                          is_pinned: draft.is_pinned,
                          user_feedback: draft.user_feedback || null,
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={memorySaving}
                      onClick={() =>
                        void runMemoryAction({
                          action: "reject_suggestion",
                          id: suggestion.id,
                          user_feedback: draft.user_feedback || null,
                        })
                      }
                    >
                      Reject
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            className="button button-danger"
            type="button"
            disabled={memorySaving}
            onClick={() => void runMemoryAction({ action: "delete_all" })}
          >
            Delete All Memories
          </button>
        </div>

        {memoryError ? <p className="error-text" style={{ marginTop: 8 }}>{memoryError}</p> : null}
      </div>
    </section>
  );
}
