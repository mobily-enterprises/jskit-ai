import { inject, onScopeDispose, ref, unref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const REALTIME_SOCKET_KEY = "jskit.realtime.runtime.client.socket";

/**
 * The socket of an application without the realtime provider: it is never connected, and nothing it is asked to do
 * happens.
 * @type {import("../types.js").RealtimeSocket}
 */
const NO_REALTIME_SOCKET = Object.freeze({
  active: false,
  connected: false,
  connect() {},
  disconnect() {},
  emit() {},
  timeout() {
    return NO_REALTIME_SOCKET;
  },
  on() {},
  off() {},
  onAny() {},
  offAny() {}
});

function matchesEveryEvent() {
  return true;
}

function resolveEnabled(value) {
  if (value === undefined) {
    return true;
  }
  return Boolean(unref(value));
}

function resolveEventName(value) {
  const normalized = normalizeText(unref(value));
  return normalized || "*";
}

/**
 * The application's socket, or `NO_REALTIME_SOCKET` in an application without the realtime provider.
 * @returns {import("../types.js").RealtimeSocket}
 */
function useRealtimeSocket() {
  return inject(REALTIME_SOCKET_KEY, NO_REALTIME_SOCKET);
}

/** @param {import("../types.js").RealtimeEventOptions} options */
function useRealtimeEvent({
  event = "*",
  enabled = true,
  matches = matchesEveryEvent,
  onEvent
}) {
  const socket = useRealtimeSocket();
  const active = ref(false);
  let release = null;

  function detach() {
    if (release) {
      try {
        release();
      } catch {}
    }
    release = null;
    active.value = false;
  }

  function runHandler(eventName, payload) {
    const context = Object.freeze({
      event: eventName,
      payload,
      socket
    });

    if (matches(context) !== true) {
      return;
    }

    Promise.resolve(onEvent(context)).catch((error) => {
      console.error(
        {
          event: eventName,
          error: String(error?.message || error || "unknown error")
        },
        "Realtime event handler failed."
      );
    });
  }

  function attach() {
    detach();

    if (socket === NO_REALTIME_SOCKET) {
      return;
    }
    if (!resolveEnabled(enabled)) {
      return;
    }

    const eventName = resolveEventName(event);
    if (eventName === "*") {
      const onAny = (nextEventName, payload) => runHandler(nextEventName, payload);
      socket.onAny(onAny);
      release = () => {
        socket.offAny(onAny);
      };
      active.value = true;
      return;
    }

    const onEventMessage = (payload) => runHandler(eventName, payload);
    socket.on(eventName, onEventMessage);
    release = () => {
      socket.off(eventName, onEventMessage);
    };
    active.value = true;
  }

  watch(
    () => [resolveEnabled(enabled), resolveEventName(event)],
    () => {
      attach();
    },
    { immediate: true }
  );

  onScopeDispose(detach);

  return {
    active
  };
}

export {
  NO_REALTIME_SOCKET,
  REALTIME_SOCKET_KEY,
  useRealtimeSocket,
  useRealtimeEvent
};
