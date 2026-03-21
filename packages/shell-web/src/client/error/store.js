import {
  normalizeAction,
  normalizeSeverity,
  normalizeText
} from "./normalize.js";
import { createListenerSubscription } from "@jskit-ai/kernel/shared/support/listenerSet";

const PRESENTATION_CHANNELS = Object.freeze(["snackbar", "banner", "dialog"]);
const SINGLETON_CHANNELS = new Set(["banner"]);

function createEmptyChannelState() {
  return {
    snackbar: [],
    banner: [],
    dialog: []
  };
}

function cloneEntry(entry = {}) {
  return Object.freeze({
    id: String(entry.id || "").trim(),
    channel: String(entry.channel || "").trim(),
    message: String(entry.message || "").trim(),
    severity: String(entry.severity || "error").trim(),
    persist: Boolean(entry.persist),
    action: entry.action || null,
    presenterId: String(entry.presenterId || "").trim(),
    dedupeKey: String(entry.dedupeKey || "").trim(),
    timestamp: Number(entry.timestamp || 0)
  });
}

function createErrorPresentationStore({
  now = () => Date.now()
} = {}) {
  const listeners = new Set();
  const subscribe = createListenerSubscription(listeners);
  const channelState = createEmptyChannelState();
  let sequence = 0;
  let revision = 0;

  function getChannelEntries(channel) {
    if (!PRESENTATION_CHANNELS.includes(channel)) {
      throw new Error(`Unknown presentation channel "${channel}".`);
    }
    return channelState[channel];
  }

  function getState() {
    return Object.freeze({
      revision,
      channels: Object.freeze({
        snackbar: Object.freeze(channelState.snackbar.map(cloneEntry)),
        banner: Object.freeze(channelState.banner.map(cloneEntry)),
        dialog: Object.freeze(channelState.dialog.map(cloneEntry))
      })
    });
  }

  function notify(event = {}) {
    const snapshot = getState();
    for (const listener of listeners) {
      try {
        listener(snapshot, Object.freeze({ ...event }));
      } catch {
        // Ignore store listener failures so one broken consumer does not break the runtime.
      }
    }
  }

  function present(channel, payload = {}) {
    const normalizedChannel = String(channel || "").trim();
    const entries = getChannelEntries(normalizedChannel);
    sequence += 1;

    const entry = Object.freeze({
      id: normalizeText(payload.id, `${normalizedChannel}-${sequence}`),
      channel: normalizedChannel,
      message: normalizeText(payload.message, "Request failed."),
      severity: normalizeSeverity(payload.severity, "error"),
      persist: typeof payload.persist === "boolean" ? payload.persist : normalizedChannel !== "snackbar",
      action: normalizeAction(payload.action),
      presenterId: normalizeText(payload.presenterId),
      dedupeKey: normalizeText(payload.dedupeKey),
      timestamp: Number(now())
    });

    if (SINGLETON_CHANNELS.has(normalizedChannel) && entries.length > 0) {
      entries.splice(0, entries.length);
    }

    entries.push(entry);
    revision += 1;

    notify({
      type: "presented",
      channel: normalizedChannel,
      id: entry.id
    });

    return entry.id;
  }

  function dismiss(channel, presentationId = "") {
    const normalizedChannel = String(channel || "").trim();
    const entries = getChannelEntries(normalizedChannel);
    const normalizedPresentationId = normalizeText(presentationId);

    if (!normalizedPresentationId) {
      if (entries.length < 1) {
        return 0;
      }
      const removed = entries.length;
      entries.splice(0, entries.length);
      revision += 1;
      notify({
        type: "dismissed",
        channel: normalizedChannel,
        id: "",
        count: removed
      });
      return removed;
    }

    const index = entries.findIndex((entry) => entry.id === normalizedPresentationId);
    if (index < 0) {
      return 0;
    }

    entries.splice(index, 1);
    revision += 1;
    notify({
      type: "dismissed",
      channel: normalizedChannel,
      id: normalizedPresentationId,
      count: 1
    });

    return 1;
  }

  function clear(channel = "") {
    const normalizedChannel = normalizeText(channel).toLowerCase();
    if (!normalizedChannel) {
      let removedCount = 0;
      for (const candidateChannel of PRESENTATION_CHANNELS) {
        removedCount += dismiss(candidateChannel, "");
      }
      return removedCount;
    }

    return dismiss(normalizedChannel, "");
  }

  return Object.freeze({
    getState,
    subscribe,
    present,
    dismiss,
    clear
  });
}

export {
  PRESENTATION_CHANNELS,
  createErrorPresentationStore
};
