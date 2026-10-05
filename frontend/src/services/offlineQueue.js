import { api } from "./api";

const DB_NAME = "ResponsAiEmergencyDB";
const DB_VERSION = 1;
const STORE_NAME = "sos_outbox";

// Open or initialize IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "client_generated_id" });
        store.createIndex("sync_status", "sync_status", { unique: false });
        store.createIndex("created_at", "created_at", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generate secure client-side emergency identifier
export function generateClientEmergencyId() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `SOS-${dateStr}-${randomPart}`;
}

// Enqueue emergency to IndexedDB outbox
export async function enqueueEmergency(payload) {
  const db = await openDB();
  const entry = {
    client_generated_id: payload.client_generated_id,
    payload,
    created_at: new Date().toISOString(),
    sync_status: "PENDING_SYNC", // PENDING_SYNC | SYNCING | SYNCED | FAILED
    retry_count: 0,
    last_attempt: null,
    last_error: null,
    serverResponse: null,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(entry);

    request.onsuccess = () => {
      notifySubscribers("ENQUEUED", entry);
      resolve(entry);
    };
    request.onerror = () => reject(request.error);
  });
}

// Retrieve single record by client_generated_id
export async function getEmergency(clientGeneratedId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(clientGeneratedId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// Retrieve all records in outbox
export async function getAllEmergencies() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Update emergency record fields
export async function updateEmergency(clientGeneratedId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(clientGeneratedId);

    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) {
        reject(new Error(`Emergency ${clientGeneratedId} not found in offline store.`));
        return;
      }
      const updatedItem = { ...item, ...updates };
      const putReq = store.put(updatedItem);

      putReq.onsuccess = () => {
        notifySubscribers("UPDATED", updatedItem);
        resolve(updatedItem);
      };
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

// Subscribers mechanism for live UI updates across components
const syncSubscribers = new Set();

export function subscribeToOfflineQueue(callback) {
  syncSubscribers.add(callback);
  return () => syncSubscribers.delete(callback);
}

function notifySubscribers(action, data) {
  syncSubscribers.forEach((cb) => {
    try {
      cb(action, data);
    } catch (e) {
      console.error("Error in sync subscriber callback:", e);
    }
  });

  // Also dispatch browser custom event
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("responsai_sos_sync", {
        detail: { action, data },
      })
    );
  }
}

// Synchronization Engine: process all pending items
let isSyncing = false;

export async function syncOfflineQueue() {
  if (isSyncing) return;
  if (!navigator.onLine) {
    console.log("[OfflineQueue] Device is currently offline; deferring sync.");
    return;
  }

  isSyncing = true;
  notifySubscribers("SYNC_START", null);

  try {
    const all = await getAllEmergencies();
    const pending = all.filter(
      (item) => item.sync_status === "PENDING_SYNC" || item.sync_status === "FAILED"
    );

    for (const item of pending) {
      try {
        await updateEmergency(item.client_generated_id, {
          sync_status: "SYNCING",
          last_attempt: new Date().toISOString(),
        });

        const response = await api.createGuestEmergency(item.payload);

        await updateEmergency(item.client_generated_id, {
          sync_status: "SYNCED",
          retry_count: (item.retry_count || 0) + 1,
          last_attempt: new Date().toISOString(),
          last_error: null,
          serverResponse: response,
        });

        notifySubscribers("SYNC_SUCCESS", {
          client_generated_id: item.client_generated_id,
          response,
        });
      } catch (err) {
        console.warn(`[OfflineQueue] Failed to sync ${item.client_generated_id}:`, err);
        await updateEmergency(item.client_generated_id, {
          sync_status: "FAILED",
          retry_count: (item.retry_count || 0) + 1,
          last_attempt: new Date().toISOString(),
          last_error: err.message || "Network / Server unreachable",
        });

        notifySubscribers("SYNC_FAILED", {
          client_generated_id: item.client_generated_id,
          error: err.message,
        });
      }
    }
  } catch (error) {
    console.error("[OfflineQueue] Error during synchronization cycle:", error);
  } finally {
    isSyncing = false;
    notifySubscribers("SYNC_COMPLETE", null);
  }
}

// Auto-register network connectivity events
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("[OfflineQueue] Network connection detected. Triggering auto-sync...");
    syncOfflineQueue();
  });
}
