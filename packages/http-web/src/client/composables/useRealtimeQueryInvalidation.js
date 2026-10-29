import { computed, nextTick, unref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { resolveEnabledRef } from "./support/refValueHelpers.js";

function normalizeRealtimeOptions(value = {}) {
  if (value === null || value === undefined || value === false) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("realtime must be an object when configured.");
  }

  return value;
}

function hasRealtimeEventConfig(value = {}) {
  const source = normalizeRealtimeOptions(value);
  return Object.hasOwn(source, "event") || Object.hasOwn(source, "events");
}

function resolveOperationRealtimeOptions({
  realtime = undefined,
  fallbackRealtime = null
} = {}) {
  if (realtime === false) {
    return null;
  }

  const fallback = normalizeRealtimeOptions(fallbackRealtime);
  const explicit = realtime == null ? {} : normalizeRealtimeOptions(realtime);
  if (hasRealtimeEventConfig(explicit) || !hasRealtimeEventConfig(fallback)) {
    return Object.keys(explicit).length > 0 ? explicit : null;
  }

  return Object.freeze({
    ...fallback,
    ...explicit
  });
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

// Realtime never cancels a read in flight: the browser would only drop its
// response while the server still runs the request in full. A query that is
// reading is read once more after that read settles, so a change made meanwhile
// is still read, and events arriving before that read starts join it. A burst
// of events therefore costs at most two reads per query.
const followUpReads = new WeakMap();

function refetchAfterCurrentRead(queryClient, query) {
  if (followUpReads.has(query)) {
    return followUpReads.get(query);
  }
  // Joins a read in flight; failures surface in the query's own state.
  const read = () => queryClient.refetchQueries({ queryKey: query.queryKey, exact: true }, { cancelRefetch: false });
  if (query.state.fetchStatus !== "fetching") {
    return read();
  }

  const followUp = read().then(() => {
    followUpReads.delete(query);
    return read();
  });
  followUpReads.set(query, followUp);
  return followUp;
}

// Marks every matching query stale, then reads again the ones on screen; the
// others read when they are next used.
async function refreshQueriesWithoutCancelling(queryClient, queryKey) {
  await queryClient.invalidateQueries({ queryKey, refetchType: "none" });
  // As TanStack's own invalidation does, read after reactive values settle.
  await nextTick();
  await Promise.all(queryClient.getQueryCache().findAll({ queryKey, type: "active" })
    .map((query) => refetchAfterCurrentRead(queryClient, query)));
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
  const active = computed(() => resolveEnabledRef(enabled) && Boolean(normalizedEvent.value));

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
        await refreshQueriesWithoutCancelling(queryClient, key);
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
  const eventList = [];
  if (Object.hasOwn(source, "event")) {
    const normalizedEvent = normalizeText(source.event);
    if (normalizedEvent) {
      eventList.push(normalizedEvent);
    }
  }
  if (Object.hasOwn(source, "events")) {
    if (!Array.isArray(source.events)) {
      throw new TypeError("realtime.events must be an array when configured.");
    }
    for (const entry of source.events) {
      const normalizedEvent = normalizeText(entry);
      if (!normalizedEvent || eventList.includes(normalizedEvent)) {
        continue;
      }
      eventList.push(normalizedEvent);
    }
  }

  if (eventList.length < 1) {
    return null;
  }

  const matches = typeof source.matches === "function" ? source.matches : null;
  const onEvent = typeof source.onEvent === "function" ? source.onEvent : null;
  const resolvedQueryKey = Object.hasOwn(source, "queryKey") ? source.queryKey : queryKey;
  const active = computed(() => {
    const sourceEnabled = Object.hasOwn(source, "enabled") ? source.enabled : true;
    return resolveEnabledRef(enabled) && resolveEnabledRef(sourceEnabled);
  });

  const bindings = eventList.map((event) =>
    useRealtimeQueryInvalidation({
      event,
      enabled: active,
      matches,
      queryKey: resolvedQueryKey,
      onEvent
    })
  );

  return Object.freeze({
    active: computed(() => bindings.some((binding) => Boolean(binding?.active?.value)))
  });
}

export {
  resolveOperationRealtimeOptions,
  useRealtimeQueryInvalidation,
  useOperationRealtime
};
