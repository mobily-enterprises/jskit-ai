import { computed, onBeforeUnmount, ref, unref, watch } from "vue";
import { useIsFetching, useIsMutating } from "@tanstack/vue-query";

const DEFAULT_DELAY_MS = 120;
const DEFAULT_MIN_VISIBLE_MS = 240;

function normalizeDuration(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function resolveNetworkBusy(fetchingCount, mutatingCount) {
  return Number(fetchingCount) > 0 || Number(mutatingCount) > 0;
}

function useGlobalNetworkActivity(options = {}) {
  const delayMs = normalizeDuration(options.delayMs, DEFAULT_DELAY_MS);
  const minVisibleMs = normalizeDuration(options.minVisibleMs, DEFAULT_MIN_VISIBLE_MS);
  const includeRefetches = options.includeRefetches === true;

  const queryFilters = includeRefetches
    ? undefined
    : {
        predicate: (query) => query?.state?.status === "pending"
      };

  const fetchingCountRef = options.fetchingCountRef ?? useIsFetching(queryFilters);
  const mutatingCountRef = options.mutatingCountRef ?? useIsMutating();

  const fetchingCount = computed(() => Number(unref(fetchingCountRef) || 0));
  const mutatingCount = computed(() => Number(unref(mutatingCountRef) || 0));
  const isBusy = computed(() => resolveNetworkBusy(fetchingCount.value, mutatingCount.value));

  const isVisible = ref(false);
  const visibleSinceMs = ref(0);

  let showTimeoutId = 0;
  let hideTimeoutId = 0;

  function clearShowTimeout() {
    if (showTimeoutId) {
      clearTimeout(showTimeoutId);
      showTimeoutId = 0;
    }
  }

  function clearHideTimeout() {
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId);
      hideTimeoutId = 0;
    }
  }

  function showNow() {
    isVisible.value = true;
    visibleSinceMs.value = Date.now();
  }

  function hideNow() {
    isVisible.value = false;
    visibleSinceMs.value = 0;
  }

  watch(
    () => isBusy.value,
    (nextBusy) => {
      if (nextBusy) {
        clearHideTimeout();
        if (isVisible.value || showTimeoutId) {
          return;
        }

        if (delayMs < 1) {
          showNow();
          return;
        }

        showTimeoutId = setTimeout(() => {
          showTimeoutId = 0;
          showNow();
        }, delayMs);
        return;
      }

      clearShowTimeout();
      if (!isVisible.value) {
        return;
      }

      const elapsedMs = Math.max(0, Date.now() - visibleSinceMs.value);
      const remainingMs = Math.max(0, minVisibleMs - elapsedMs);
      if (remainingMs < 1) {
        hideNow();
        return;
      }

      if (hideTimeoutId) {
        return;
      }

      hideTimeoutId = setTimeout(() => {
        hideTimeoutId = 0;
        hideNow();
      }, remainingMs);
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    clearShowTimeout();
    clearHideTimeout();
  });

  return {
    fetchingCount,
    mutatingCount,
    isBusy,
    isVisible
  };
}

const __testables = {
  normalizeDuration,
  resolveNetworkBusy
};

export { useGlobalNetworkActivity, DEFAULT_DELAY_MS, DEFAULT_MIN_VISIBLE_MS, __testables };
