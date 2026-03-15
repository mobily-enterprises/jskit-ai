import { computed, unref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";

function normalizeRealtimeOptions(value = {}) {
  if (value === null || value === undefined || value === false) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("realtime must be an object when configured.");
  }

  return value;
}

function resolveEnabled(value) {
  if (typeof value === "undefined") {
    return true;
  }

  return Boolean(unref(value));
}

function toQueryKeyList(value) {
  const resolved = typeof value === "function" ? value() : unref(value);
  if (!Array.isArray(resolved) || resolved.length < 1) {
    return [];
  }

  if (Array.isArray(resolved[0])) {
    return resolved
      .filter((entry) => Array.isArray(entry) && entry.length > 0)
      .map((entry) => Object.freeze([...entry]));
  }

  return [Object.freeze([...resolved])];
}

function useRealtimeQueryInvalidation({
  event = "",
  enabled = true,
  matches = null,
  queryKey = null,
  onEvent = null
} = {}) {
  const queryClient = useQueryClient();
  const normalizedEvent = computed(() => normalizeText(unref(event)));
  const active = computed(() => resolveEnabled(enabled) && Boolean(normalizedEvent.value));

  const listener = useRealtimeEvent({
    event: normalizedEvent,
    enabled: active,
    matches,
    onEvent: async (context) => {
      if (typeof onEvent === "function") {
        await onEvent(context);
      }

      const keys = toQueryKeyList(queryKey);
      for (const key of keys) {
        await queryClient.invalidateQueries({
          queryKey: key
        });
      }
    }
  });

  return Object.freeze({
    active: listener.active
  });
}

function useOperationRealtime({
  realtime = null,
  queryKey = null,
  enabled = true
} = {}) {
  const source = normalizeRealtimeOptions(realtime);
  if (!source.event) {
    return null;
  }

  const event = source.event;
  const matches = typeof source.matches === "function" ? source.matches : null;
  const onEvent = typeof source.onEvent === "function" ? source.onEvent : null;
  const resolvedQueryKey = Object.hasOwn(source, "queryKey") ? source.queryKey : queryKey;
  const active = computed(() => {
    const sourceEnabled = Object.hasOwn(source, "enabled") ? source.enabled : true;
    return resolveEnabled(enabled) && resolveEnabled(sourceEnabled);
  });

  return useRealtimeQueryInvalidation({
    event,
    enabled: active,
    matches,
    queryKey: resolvedQueryKey,
    onEvent
  });
}

export {
  useRealtimeQueryInvalidation,
  useOperationRealtime
};
