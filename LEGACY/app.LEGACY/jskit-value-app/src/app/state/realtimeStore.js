import { defineStore } from "pinia";

function normalizeConnectionState(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || "idle";
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

export const useRealtimeStore = defineStore("realtime", {
  state: () => ({
    connectionState: "idle",
    reason: "",
    reconnectAttempt: 0,
    reconnectDelayMs: 0,
    updatedAt: ""
  }),
  getters: {
    healthLabel(state) {
      const normalizedState = normalizeConnectionState(state.connectionState);
      if (normalizedState === "subscribed") {
        return "Realtime: live";
      }
      if (normalizedState === "connected" || normalizedState === "connecting") {
        return "Realtime: connecting";
      }
      if (normalizedState === "reconnect_scheduled") {
        return "Realtime: retrying";
      }
      if (normalizedState === "forbidden") {
        return "Realtime: blocked";
      }
      if (normalizedState === "connect_error" || normalizedState === "disconnected") {
        return "Realtime: offline";
      }

      return "Realtime: idle";
    },
    healthColor(state) {
      const normalizedState = normalizeConnectionState(state.connectionState);
      if (normalizedState === "subscribed") {
        return "success";
      }
      if (normalizedState === "connected" || normalizedState === "connecting") {
        return "info";
      }
      if (normalizedState === "reconnect_scheduled") {
        return "warning";
      }
      if (normalizedState === "forbidden" || normalizedState === "connect_error" || normalizedState === "disconnected") {
        return "error";
      }

      return "secondary";
    }
  },
  actions: {
    applyConnectionState(payload = {}) {
      this.connectionState = normalizeConnectionState(payload.state);
      this.reason = String(payload.reason || "").trim();
      this.reconnectAttempt = toPositiveInteger(payload.attempt);
      this.reconnectDelayMs = toPositiveInteger(payload.delayMs);
      this.updatedAt = new Date().toISOString();
    },
    resetConnectionState() {
      this.connectionState = "idle";
      this.reason = "";
      this.reconnectAttempt = 0;
      this.reconnectDelayMs = 0;
      this.updatedAt = new Date().toISOString();
    }
  }
});
