import { inject, onBeforeUnmount, ref, unref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { REALTIME_SOCKET_CLIENT_INJECTION_KEY } from "../tokens.js";

const EMPTY_REALTIME_SOCKET = Object.freeze({
  on() {},
  off() {},
  onAny() {},
  offAny() {}
});

function isRealtimeSocket(socket) {
  return Boolean(
    socket &&
      typeof socket === "object" &&
      typeof socket.on === "function" &&
      typeof socket.off === "function"
  );
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

function useRealtimeSocket({ required = false } = {}) {
  const socket = inject(REALTIME_SOCKET_CLIENT_INJECTION_KEY, null);
  if (isRealtimeSocket(socket)) {
    return socket;
  }

  if (required) {
    throw new Error("Realtime client socket is not available in Vue injection context.");
  }

  return EMPTY_REALTIME_SOCKET;
}

function useRealtimeEvent({
  event = "*",
  enabled = true,
  matches = null,
  onEvent
} = {}) {
  if (typeof onEvent !== "function") {
    throw new TypeError("useRealtimeEvent requires onEvent().");
  }

  const socket = useRealtimeSocket({ required: false });
  const active = ref(false);
  let release = null;

  function detach() {
    if (typeof release === "function") {
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

    if (typeof matches === "function" && matches(context) !== true) {
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

    if (socket === EMPTY_REALTIME_SOCKET) {
      return;
    }
    if (!resolveEnabled(enabled)) {
      return;
    }

    const eventName = resolveEventName(event);
    if (eventName === "*") {
      if (typeof socket.onAny !== "function") {
        return;
      }
      const onAny = (nextEventName, payload) => runHandler(nextEventName, payload);
      socket.onAny(onAny);
      release = () => {
        if (typeof socket.offAny === "function") {
          socket.offAny(onAny);
        }
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

  onBeforeUnmount(() => {
    detach();
  });

  return Object.freeze({
    active
  });
}

export {
  EMPTY_REALTIME_SOCKET,
  useRealtimeSocket,
  useRealtimeEvent
};
