"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DeviceInfo } from "@/lib/devices/types";
import {
  getSessionInventoryDisplayName,
  loadSessionInventoryFromStorage,
  needsInventoryClarification,
  saveSessionInventoryToStorage,
  type SessionInventoryCategory,
  type SessionInventoryItem,
} from "@/lib/session/session-inventory";

export default function InventoryClient() {
  const [sessionInventory, setSessionInventory] = useState<SessionInventoryItem[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    return loadSessionInventoryFromStorage(window.localStorage);
  });
  const [inventoryLabelDraft, setInventoryLabelDraft] = useState("");
  const [inventoryCategoryDraft, setInventoryCategoryDraft] =
    useState<SessionInventoryCategory>("device");
  const [inventoryAvailableDraft, setInventoryAvailableDraft] = useState(true);
  const [inventoryIntifaceDraft, setInventoryIntifaceDraft] = useState(false);
  const [inventoryLinkedDeviceDraft, setInventoryLinkedDeviceDraft] = useState("");
  const [inventoryNotesDraft, setInventoryNotesDraft] = useState("");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const inventoryAvailableCount = useMemo(
    () => sessionInventory.filter((item) => item.available_this_session).length,
    [sessionInventory],
  );
  const inventoryIntifaceCount = useMemo(
    () =>
      sessionInventory.filter(
        (item) =>
          item.available_this_session &&
          item.intiface_controlled &&
          typeof item.linked_device_id === "string" &&
          item.linked_device_id.length > 0,
      ).length,
    [sessionInventory],
  );
  const inventoryClarificationCount = useMemo(
    () => sessionInventory.filter((item) => needsInventoryClarification(item)).length,
    [sessionInventory],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const response = await fetch("/api/devices/list", { cache: "no-store" });
      if (!response.ok) {
        setDevices([]);
        return;
      }
      const payload = (await response.json()) as { devices?: DeviceInfo[] };
      setDevices(Array.isArray(payload.devices) ? payload.devices : []);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    saveSessionInventoryToStorage(window.localStorage, sessionInventory);
  }, [sessionInventory]);

  function addSessionInventoryItem() {
    const label = inventoryLabelDraft.trim();
    if (!label) {
      setMessage("Enter an inventory item label first.");
      return;
    }
    const nextItem: SessionInventoryItem = {
      id: `inv-${Date.now()}`,
      label,
      category: inventoryCategoryDraft,
      available_this_session: inventoryAvailableDraft,
      intiface_controlled: inventoryIntifaceDraft,
      linked_device_id:
        inventoryIntifaceDraft && inventoryLinkedDeviceDraft.trim()
          ? inventoryLinkedDeviceDraft.trim()
          : null,
      notes: inventoryNotesDraft.trim(),
    };
    setSessionInventory((current) => [...current, nextItem]);
    setInventoryLabelDraft("");
    setInventoryCategoryDraft("device");
    setInventoryAvailableDraft(true);
    setInventoryIntifaceDraft(false);
    setInventoryLinkedDeviceDraft("");
    setInventoryNotesDraft("");
    setMessage("Inventory saved locally.");
  }

  function updateSessionInventoryItem(
    itemId: string,
    patch: Partial<SessionInventoryItem>,
  ) {
    setSessionInventory((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        const nextLinkedDeviceId =
          patch.intiface_controlled === false
            ? null
            : patch.linked_device_id !== undefined
              ? patch.linked_device_id
              : item.linked_device_id;
        return {
          ...item,
          ...patch,
          linked_device_id: nextLinkedDeviceId,
        };
      }),
    );
    setMessage("Inventory updated.");
  }

  function removeSessionInventoryItem(itemId: string) {
    setSessionInventory((current) => current.filter((item) => item.id !== itemId));
    setMessage("Item removed.");
  }

  function clearAllItems() {
    setSessionInventory([]);
    setMessage("Inventory cleared.");
  }

  return (
    <section className="panel">
      <div className="status-strip">
        <div className="status-pill">
          <strong>{sessionInventory.length}</strong>
          <span>Items listed</span>
        </div>
        <div className="status-pill">
          <strong>{inventoryAvailableCount}</strong>
          <span>Available this session</span>
        </div>
        <div className="status-pill">
          <strong>{inventoryIntifaceCount}</strong>
          <span>Intiface-ready</span>
        </div>
        <div className="status-pill">
          <strong>{inventoryClarificationCount}</strong>
          <span>Needs detail</span>
        </div>
      </div>

      <div className="card">
        <h1>Session Inventory</h1>
        <p className="muted">
          Saved locally and reused across sessions. Update availability each session so Raven only
          uses what is actually on hand.
        </p>
        <div className="camera-controls">
          <Link className="button button-secondary" href="/session">
            Back to Session
          </Link>
          <button className="button button-secondary" type="button" onClick={() => void refreshDevices()}>
            Refresh devices
          </button>
        </div>
        {message ? <p>{message}</p> : null}
      </div>

      <div className="card">
        <h2>Add Item</h2>
        <div className="input-grid">
          <label className="field-block">
            <span>Label</span>
            <input
              value={inventoryLabelDraft}
              onChange={(event) => setInventoryLabelDraft(event.target.value)}
              placeholder="Steel Cage"
            />
          </label>
          <label className="field-block">
            <span>Category</span>
            <select
              value={inventoryCategoryDraft}
              onChange={(event) =>
                setInventoryCategoryDraft(event.target.value as SessionInventoryCategory)
              }
            >
              <option value="device">Device</option>
              <option value="clothing">Clothing</option>
              <option value="accessory">Accessory</option>
              <option value="toy">Toy</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field-block">
            <span>Notes</span>
            <input
              value={inventoryNotesDraft}
              onChange={(event) => setInventoryNotesDraft(event.target.value)}
              placeholder="metal, lockable"
            />
          </label>
        </div>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={inventoryAvailableDraft}
            onChange={(event) => setInventoryAvailableDraft(event.target.checked)}
          />
          <span>Available for this session</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={inventoryIntifaceDraft}
            onChange={(event) => {
              const next = event.target.checked;
              setInventoryIntifaceDraft(next);
              if (!next) {
                setInventoryLinkedDeviceDraft("");
              }
            }}
          />
          <span>Offers Intiface control</span>
        </label>
        {inventoryIntifaceDraft ? (
          <label className="field-block">
            <span>Linked device</span>
            <select
              value={inventoryLinkedDeviceDraft}
              onChange={(event) => setInventoryLinkedDeviceDraft(event.target.value)}
            >
              <option value="">Select device id</option>
              {devices.map((device) => (
                <option key={`inventory-link-${device.device_id}`} value={device.device_id}>
                  {device.name} ({device.device_id})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="camera-controls">
          <button className="button button-secondary" type="button" onClick={addSessionInventoryItem}>
            Add item
          </button>
          <button className="button button-secondary" type="button" onClick={clearAllItems}>
            Clear all
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Saved Items</h2>
        {sessionInventory.length === 0 ? (
          <p className="muted">No items saved yet.</p>
        ) : (
          <div className="compact-grid">
            {sessionInventory.map((item) => (
              <div key={item.id} className="task-card">
                <div className="status-strip">
                  <div className="status-pill">
                    <strong>{getSessionInventoryDisplayName(item)}</strong>
                    <span>{item.category}</span>
                  </div>
                  <div className="status-pill">
                    <strong>{needsInventoryClarification(item) ? "Needs detail" : "Clear enough"}</strong>
                    <span>
                      {needsInventoryClarification(item)
                        ? "Raven will ask first"
                        : "Raven can use it directly"}
                    </span>
                  </div>
                  <div className="status-pill">
                    <strong>{item.available_this_session ? "Available" : "Unavailable"}</strong>
                    <span>{item.intiface_controlled ? "Intiface capable" : "Manual use only"}</span>
                  </div>
                </div>
                <p>
                  label={item.label} available={item.available_this_session ? "yes" : "no"} intiface=
                  {item.intiface_controlled ? "yes" : "no"}
                  {item.linked_device_id ? ` device=${item.linked_device_id}` : ""}
                </p>
                {item.notes ? <p className="muted">{item.notes}</p> : null}
                <div className="camera-controls">
                  <label className="field-checkbox">
                    <input
                      type="checkbox"
                      checked={item.available_this_session}
                      onChange={(event) =>
                        updateSessionInventoryItem(item.id, {
                          available_this_session: event.target.checked,
                        })
                      }
                    />
                    <span>Available</span>
                  </label>
                  <label className="field-checkbox">
                    <input
                      type="checkbox"
                      checked={item.intiface_controlled}
                      onChange={(event) =>
                        updateSessionInventoryItem(item.id, {
                          intiface_controlled: event.target.checked,
                          linked_device_id: event.target.checked ? item.linked_device_id : null,
                        })
                      }
                    />
                    <span>Intiface</span>
                  </label>
                  {item.intiface_controlled ? (
                    <select
                      value={item.linked_device_id ?? ""}
                      onChange={(event) =>
                        updateSessionInventoryItem(item.id, {
                          linked_device_id: event.target.value.trim() || null,
                        })
                      }
                    >
                      <option value="">Select device id</option>
                      {devices.map((device) => (
                        <option key={`${item.id}-${device.device_id}`} value={device.device_id}>
                          {device.name} ({device.device_id})
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => removeSessionInventoryItem(item.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
