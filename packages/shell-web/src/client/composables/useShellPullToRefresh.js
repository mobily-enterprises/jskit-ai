import { computed, onBeforeUnmount, onMounted, ref, unref } from "vue";
import { isPrimaryTouchPointer, isShellGestureIgnoredTarget } from "../support/gestureTargets.js";

const PULL_REFRESH_TRIGGER_DISTANCE = 72;
const PULL_REFRESH_MAX_DISTANCE = 112;
const PULL_REFRESH_IGNORED_SELECTORS = Object.freeze(["[data-shell-pull-refresh-ignore]"]);

function isAtPageTop() {
  if (typeof window !== "object" || typeof document !== "object") {
    return false;
  }

  const documentScrollTop = Number(document.documentElement?.scrollTop || 0);
  const bodyScrollTop = Number(document.body?.scrollTop || 0);
  return Math.max(Number(window.scrollY || 0), documentScrollTop, bodyScrollTop) <= 0;
}

// Compact-layout pull-to-refresh. Pointer events start the gesture where the
// browser supports them; touch events carry it on after the browser cancels the
// pointer to scroll, and start it where pointer events are missing.
function useShellPullToRefresh({ enabled, refreshRuntime = null } = {}) {
  const pullDistance = ref(0);
  const pullRefreshing = ref(false);
  let activePull = null;

  const pullProgress = computed(() =>
    Math.min(100, Math.round((pullDistance.value / PULL_REFRESH_TRIGGER_DISTANCE) * 100))
  );
  const pullIndicatorVisible = computed(() =>
    Boolean(unref(enabled) && (pullDistance.value > 0 || pullRefreshing.value))
  );
  const pullRefreshLabel = computed(() => {
    if (pullRefreshing.value) {
      return "Refreshing";
    }
    return pullProgress.value >= 100 ? "Release to refresh" : "Pull to refresh";
  });
  const pullRefreshStyle = computed(() => ({
    "--shell-pull-refresh-distance": `${Math.round(Math.min(pullDistance.value, PULL_REFRESH_MAX_DISTANCE))}px`
  }));

  onMounted(() => {
    if (typeof window !== "object") {
      return;
    }
    window.addEventListener("pointerdown", handlePullPointerDown, { capture: true, passive: true });
    window.addEventListener("pointermove", handlePullPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePullPointerEnd, { capture: true, passive: true });
    window.addEventListener("pointercancel", handlePullPointerCancel, { capture: true, passive: true });
    window.addEventListener("touchstart", handlePullTouchStart, { capture: true, passive: true });
    window.addEventListener("touchmove", handlePullTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", handlePullTouchEnd, { capture: true, passive: true });
    window.addEventListener("touchcancel", handlePullTouchCancel, { capture: true, passive: true });
  });

  onBeforeUnmount(() => {
    if (typeof window !== "object") {
      return;
    }
    window.removeEventListener("pointerdown", handlePullPointerDown, { capture: true });
    window.removeEventListener("pointermove", handlePullPointerMove, { capture: true });
    window.removeEventListener("pointerup", handlePullPointerEnd, { capture: true });
    window.removeEventListener("pointercancel", handlePullPointerCancel, { capture: true });
    window.removeEventListener("touchstart", handlePullTouchStart, { capture: true });
    window.removeEventListener("touchmove", handlePullTouchMove, { capture: true });
    window.removeEventListener("touchend", handlePullTouchEnd, { capture: true });
    window.removeEventListener("touchcancel", handlePullTouchCancel, { capture: true });
  });

  function canRefresh() {
    return Boolean(refreshRuntime && typeof refreshRuntime.refresh === "function");
  }

  function canStartFromTarget(target) {
    return Boolean(
      unref(enabled) &&
      canRefresh() &&
      !pullRefreshing.value &&
      isAtPageTop() &&
      !isShellGestureIgnoredTarget(target, { extraSelectors: PULL_REFRESH_IGNORED_SELECTORS })
    );
  }

  function handlePullPointerDown(event) {
    if (!isPrimaryTouchPointer(event) || !canStartFromTarget(event.target)) {
      activePull = null;
      return;
    }

    activePull = {
      pointerId: event.pointerId,
      touchIdentifier: null,
      startX: event.clientX,
      startY: event.clientY
    };
  }

  function handlePullPointerMove(event) {
    if (!activePull || event.pointerId !== activePull.pointerId) {
      return;
    }

    updatePullGesture(event.clientX, event.clientY, event);
  }

  function handlePullPointerEnd(event) {
    if (!activePull || event.pointerId !== activePull.pointerId) {
      return;
    }

    finishPullGesture();
  }

  // The browser cancels the pointer when it takes over scrolling; touch events
  // keep following the same finger.
  function handlePullPointerCancel(event) {
    if (!activePull || event.pointerId !== activePull.pointerId) {
      return;
    }

    activePull.pointerId = null;
  }

  function handlePullTouchStart(event) {
    if (activePull || event?.touches?.length !== 1 || !canStartFromTarget(event.target)) {
      return;
    }

    const touch = event.touches[0];
    activePull = {
      pointerId: null,
      touchIdentifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY
    };
  }

  function handlePullTouchMove(event) {
    const touch = findActiveTouch(event.touches);
    if (!activePull || !touch) {
      return;
    }

    updatePullGesture(touch.clientX, touch.clientY, event);
  }

  function handlePullTouchEnd(event) {
    if (!activePull || !touchListIncludesActiveTouch(event.changedTouches)) {
      return;
    }

    finishPullGesture();
  }

  function handlePullTouchCancel(event) {
    if (activePull && touchListIncludesActiveTouch(event.changedTouches)) {
      cancelPullRefresh();
    }
  }

  function updatePullGesture(clientX, clientY, event) {
    if (!activePull) {
      return;
    }

    const deltaX = clientX - activePull.startX;
    const deltaY = clientY - activePull.startY;
    const absX = Math.abs(deltaX);

    if (deltaY < -4 || (absX > 24 && absX > deltaY * 1.15)) {
      cancelPullRefresh();
      return;
    }

    if (deltaY <= 6 || !isAtPageTop()) {
      return;
    }

    if (event?.cancelable) {
      event.preventDefault();
    }
    pullDistance.value = Math.min(PULL_REFRESH_MAX_DISTANCE, Math.round(deltaY * 0.55));
  }

  function finishPullGesture() {
    const shouldRefresh = pullDistance.value >= PULL_REFRESH_TRIGGER_DISTANCE;
    activePull = null;

    if (!shouldRefresh) {
      pullDistance.value = 0;
      return;
    }

    void refreshFromPullGesture();
  }

  function cancelPullRefresh() {
    activePull = null;
    if (!pullRefreshing.value) {
      pullDistance.value = 0;
    }
  }

  async function refreshFromPullGesture() {
    if (!canRefresh() || pullRefreshing.value) {
      pullDistance.value = 0;
      return;
    }

    pullRefreshing.value = true;
    pullDistance.value = PULL_REFRESH_TRIGGER_DISTANCE;
    try {
      await refreshRuntime.refresh("pull-to-refresh");
    } finally {
      pullRefreshing.value = false;
      pullDistance.value = 0;
    }
  }

  function findActiveTouch(touchList) {
    if (!activePull || !touchList || touchList.length < 1) {
      return null;
    }

    if (activePull.touchIdentifier === null && touchList.length === 1) {
      return touchList[0];
    }

    for (const touch of touchList) {
      if (touch.identifier === activePull.touchIdentifier) {
        return touch;
      }
    }

    return null;
  }

  function touchListIncludesActiveTouch(touchList) {
    if (!activePull) {
      return false;
    }

    if (activePull.touchIdentifier === null) {
      return !touchList || touchList.length <= 1;
    }

    return Boolean(findActiveTouch(touchList));
  }

  return {
    pullDistance,
    pullRefreshing,
    pullProgress,
    pullIndicatorVisible,
    pullRefreshLabel,
    pullRefreshStyle
  };
}

export { useShellPullToRefresh };
