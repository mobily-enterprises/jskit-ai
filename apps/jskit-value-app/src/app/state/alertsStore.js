import { defineStore } from "pinia";
import { api } from "../../platform/http/api/index.js";
import { subscribeRealtimeEvents } from "../../platform/realtime/realtimeEventBus.js";

const PREVIEW_PAGE = 1;
const PREVIEW_PAGE_SIZE = 20;
const MAX_PREVIEW_ENTRIES = 20;
const MAX_PAGE_SIZE = 100;
const POLLING_INTERVAL_MS = 25_000;
const ALERTS_SYNC_STORAGE_KEY = "jskit.alerts.sync";
const ALERTS_SYNC_CHANNEL_NAME = "jskit.alerts.sync";
const ALERTS_REALTIME_TOPIC = "alerts";
const ALERTS_REALTIME_EVENT_TYPE = "user.alert.created";
const TAB_ID = Math.random().toString(36).slice(2);

let syncBroadcastChannel = null;
let syncStorageListener = null;
let syncFocusListener = null;
let syncVisibilityListener = null;
let realtimeAlertsUnsubscribe = null;

function isClientRuntime() {
  return typeof window !== "undefined";
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function normalizeNullablePositiveInteger(value) {
  const parsed = toPositiveInteger(value);
  return parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeTargetUrl(value) {
  const targetUrl = normalizeText(value);
  if (!targetUrl.startsWith("/")) {
    return "";
  }

  const lower = targetUrl.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//")) {
    return "";
  }

  return targetUrl;
}

function normalizeCreatedAt(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = toPositiveInteger(entry.id);
  const userId = toPositiveInteger(entry.userId);
  const targetUrl = normalizeTargetUrl(entry.targetUrl);
  const createdAt = normalizeCreatedAt(entry.createdAt);
  if (!id || !userId || !targetUrl || !createdAt) {
    return null;
  }

  return {
    id,
    userId,
    type: normalizeText(entry.type).toLowerCase(),
    title: normalizeText(entry.title),
    message: entry.message == null ? null : normalizeText(entry.message) || null,
    targetUrl,
    payloadJson: entry.payloadJson && typeof entry.payloadJson === "object" ? { ...entry.payloadJson } : null,
    actorUserId: normalizeNullablePositiveInteger(entry.actorUserId),
    workspaceId: normalizeNullablePositiveInteger(entry.workspaceId),
    createdAt
  };
}

function normalizePage(value, fallback = 1) {
  return Math.max(1, toPositiveInteger(value) || fallback);
}

function normalizePageSize(value, fallback = PREVIEW_PAGE_SIZE) {
  const parsed = toPositiveInteger(value) || fallback;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, parsed));
}

function normalizeListResponse(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const pageSize = normalizePageSize(source.pageSize, PREVIEW_PAGE_SIZE);
  const total = Math.max(0, Number(source.total) || 0);
  const totalPages = Math.max(1, Number(source.totalPages) || Math.ceil(total / pageSize) || 1);
  const page = Math.min(normalizePage(source.page, 1), totalPages);

  return {
    entries: (Array.isArray(source.entries) ? source.entries : []).map(normalizeEntry).filter(Boolean),
    page,
    pageSize,
    total,
    totalPages,
    unreadCount: Math.max(0, Number(source.unreadCount) || 0),
    readThroughAlertId: normalizeNullablePositiveInteger(source.readThroughAlertId)
  };
}

function normalizeMarkAllReadResponse(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    unreadCount: Math.max(0, Number(source.unreadCount) || 0),
    readThroughAlertId: normalizeNullablePositiveInteger(source.readThroughAlertId)
  };
}

function buildSyncPayload(type) {
  return {
    senderId: TAB_ID,
    type: normalizeText(type) || "refresh",
    timestamp: Date.now()
  };
}

function parseSyncPayload(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      senderId: normalizeText(parsed.senderId),
      type: normalizeText(parsed.type) || "refresh",
      timestamp: Number(parsed.timestamp) || Date.now()
    };
  } catch {
    return null;
  }
}

function shouldApplySyncPayload(payload) {
  return Boolean(payload && payload.senderId && payload.senderId !== TAB_ID);
}

function emitAlertsSync(type) {
  if (!isClientRuntime()) {
    return;
  }

  const payload = buildSyncPayload(type);
  if (syncBroadcastChannel) {
    try {
      syncBroadcastChannel.postMessage(payload);
    } catch {
      // Ignore sync channel failures.
    }
  }

  try {
    window.localStorage.setItem(ALERTS_SYNC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write failures.
  }
}

function shouldRefreshFromRealtimeEvent(event) {
  const topic = normalizeText(event?.topic).toLowerCase();
  if (topic === ALERTS_REALTIME_TOPIC) {
    return true;
  }

  const eventType = normalizeText(event?.eventType).toLowerCase();
  return eventType === ALERTS_REALTIME_EVENT_TYPE;
}

function attachCrossTabSyncListeners(store) {
  if (!isClientRuntime()) {
    return;
  }

  if (!syncStorageListener) {
    syncStorageListener = (event) => {
      if (event?.key !== ALERTS_SYNC_STORAGE_KEY) {
        return;
      }

      const payload = parseSyncPayload(event.newValue);
      if (!shouldApplySyncPayload(payload)) {
        return;
      }

      void store.refreshPreview({
        silent: true,
        broadcast: false
      });
    };
    window.addEventListener("storage", syncStorageListener);
  }

  if (!syncFocusListener) {
    syncFocusListener = () => {
      void store.refreshPreview({
        silent: true,
        broadcast: false
      });
    };
    window.addEventListener("focus", syncFocusListener);
  }

  if (!syncVisibilityListener) {
    syncVisibilityListener = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void store.refreshPreview({
        silent: true,
        broadcast: false
      });
    };
    document.addEventListener("visibilitychange", syncVisibilityListener);
  }

  if (!syncBroadcastChannel && typeof window.BroadcastChannel === "function") {
    try {
      syncBroadcastChannel = new window.BroadcastChannel(ALERTS_SYNC_CHANNEL_NAME);
      syncBroadcastChannel.onmessage = (event) => {
        const payload = parseSyncPayload(event?.data);
        if (!shouldApplySyncPayload(payload)) {
          return;
        }

        void store.refreshPreview({
          silent: true,
          broadcast: false
        });
      };
    } catch {
      syncBroadcastChannel = null;
    }
  }
}

function attachRealtimeAlertsListener(store) {
  if (realtimeAlertsUnsubscribe || typeof subscribeRealtimeEvents !== "function") {
    return;
  }

  realtimeAlertsUnsubscribe = subscribeRealtimeEvents((event) => {
    if (!shouldRefreshFromRealtimeEvent(event)) {
      return;
    }

    void store.refreshPreview({
      silent: true,
      broadcast: true
    });
  });
}

function detachRealtimeAlertsListener() {
  if (!realtimeAlertsUnsubscribe) {
    return;
  }

  try {
    realtimeAlertsUnsubscribe();
  } finally {
    realtimeAlertsUnsubscribe = null;
  }
}

function detachCrossTabSyncListeners() {
  if (!isClientRuntime()) {
    return;
  }

  if (syncStorageListener) {
    window.removeEventListener("storage", syncStorageListener);
    syncStorageListener = null;
  }

  if (syncFocusListener) {
    window.removeEventListener("focus", syncFocusListener);
    syncFocusListener = null;
  }

  if (syncVisibilityListener) {
    document.removeEventListener("visibilitychange", syncVisibilityListener);
    syncVisibilityListener = null;
  }

  if (syncBroadcastChannel) {
    try {
      syncBroadcastChannel.close();
    } catch {
      // Ignore close failures.
    }
    syncBroadcastChannel = null;
  }
}

export const useAlertsStore = defineStore("alerts", {
  state: () => ({
    initialized: false,
    previewEntries: [],
    unreadCount: 0,
    readThroughAlertId: null,
    previewLoading: false,
    previewError: "",
    listLoading: false,
    listError: "",
    markAllReadLoading: false,
    markAllReadError: "",
    pollingTimerHandle: null
  }),
  actions: {
    async refreshPreview({ silent = false, broadcast = true } = {}) {
      if (!silent) {
        this.previewLoading = true;
      }
      this.previewError = "";

      const previousUnreadCount = this.unreadCount;
      const previousReadThroughAlertId = this.readThroughAlertId;

      try {
        const payload = await api.alerts.list({
          page: PREVIEW_PAGE,
          pageSize: PREVIEW_PAGE_SIZE
        });
        const normalized = normalizeListResponse(payload);

        this.previewEntries = normalized.entries.slice(0, MAX_PREVIEW_ENTRIES);
        this.unreadCount = normalized.unreadCount;
        this.readThroughAlertId = normalized.readThroughAlertId;
        this.initialized = true;

        if (
          broadcast &&
          (previousUnreadCount !== this.unreadCount || previousReadThroughAlertId !== this.readThroughAlertId)
        ) {
          emitAlertsSync("refresh");
        }

        return normalized;
      } catch (error) {
        this.previewError = String(error?.message || "Unable to load alerts.");
        throw error;
      } finally {
        if (!silent) {
          this.previewLoading = false;
        }
      }
    },

    async listPage({ page = 1, pageSize = PREVIEW_PAGE_SIZE } = {}) {
      this.listLoading = true;
      this.listError = "";

      try {
        const payload = await api.alerts.list({
          page: normalizePage(page),
          pageSize: normalizePageSize(pageSize)
        });
        const normalized = normalizeListResponse(payload);

        this.unreadCount = normalized.unreadCount;
        this.readThroughAlertId = normalized.readThroughAlertId;
        this.initialized = true;
        if (normalized.page === PREVIEW_PAGE) {
          this.previewEntries = normalized.entries.slice(0, MAX_PREVIEW_ENTRIES);
        }

        return normalized;
      } catch (error) {
        this.listError = String(error?.message || "Unable to list alerts.");
        throw error;
      } finally {
        this.listLoading = false;
      }
    },

    async markAllRead({ broadcast = true } = {}) {
      this.markAllReadLoading = true;
      this.markAllReadError = "";

      try {
        const payload = await api.alerts.markAllRead();
        const normalized = normalizeMarkAllReadResponse(payload);

        this.unreadCount = normalized.unreadCount;
        this.readThroughAlertId = normalized.readThroughAlertId;
        this.initialized = true;

        if (broadcast) {
          emitAlertsSync("read_all");
        }

        return normalized;
      } catch (error) {
        this.markAllReadError = String(error?.message || "Unable to mark alerts as read.");
        throw error;
      } finally {
        this.markAllReadLoading = false;
      }
    },

    async handleAlertClick(alert, hardNavigate) {
      const targetUrl = normalizeTargetUrl(alert?.targetUrl);
      if (!targetUrl) {
        return null;
      }

      await this.markAllRead();

      if (typeof hardNavigate === "function") {
        await hardNavigate(targetUrl);
        return targetUrl;
      }

      if (isClientRuntime()) {
        window.location.assign(targetUrl);
      }

      return targetUrl;
    },

    async startPolling() {
      if (this.pollingTimerHandle) {
        return;
      }

      attachCrossTabSyncListeners(this);
      attachRealtimeAlertsListener(this);

      try {
        await this.refreshPreview({
          silent: false,
          broadcast: false
        });
      } catch {
        // Initial preview load is best-effort; polling continues.
      }

      this.pollingTimerHandle = setInterval(() => {
        void this.refreshPreview({
          silent: true,
          broadcast: true
        }).catch(() => {});
      }, POLLING_INTERVAL_MS);
    },

    stopPolling() {
      if (this.pollingTimerHandle) {
        clearInterval(this.pollingTimerHandle);
        this.pollingTimerHandle = null;
      }

      detachCrossTabSyncListeners();
      detachRealtimeAlertsListener();
    }
  }
});
