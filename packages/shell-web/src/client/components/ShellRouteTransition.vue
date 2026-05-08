<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import { normalizePathname } from "@jskit-ai/kernel/shared";
import { resolveShellLinkPath } from "../navigation/linkResolver.js";
import {
  useWebPlacementContext,
  useWebPlacementRuntime
} from "../placement/inject.js";
import { resolveRuntimePathname } from "../placement/pathname.js";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceNavigationTargetFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname
} from "../placement/surfaceContext.js";
import {
  normalizeMenuLinkPathname,
  resolveMenuLinkTarget
} from "../support/menuLinkTarget.js";

const props = defineProps({
  enabled: {
    type: Boolean,
    default: true
  },
  target: {
    type: String,
    default: "shell-layout:primary-bottom-nav"
  },
  semanticTarget: {
    type: String,
    default: "shell.primary-nav"
  },
  swipeEnabled: {
    type: Boolean,
    default: true
  }
});

const route = useRoute();
const router = useRouter();
const display = useDisplay();
const placementRuntime = useWebPlacementRuntime();
const { context: placementContext } = useWebPlacementContext();
const revision = ref(
  typeof placementRuntime.getRevision === "function" ? placementRuntime.getRevision() : 0
);
const transitionDirection = ref("none");
let unsubscribe = null;
let activeSwipe = null;
let stopSwipeClassWatch = null;

const SWIPE_MIN_DISTANCE = 36;
const SWIPE_MAX_VERTICAL_DRIFT = 120;
const SWIPE_MIN_VELOCITY = 0.08;

onMounted(() => {
  if (typeof placementRuntime.subscribe !== "function") {
    unsubscribe = null;
  } else {
    unsubscribe = placementRuntime.subscribe((event) => {
      const next = Number(event?.revision);
      revision.value = Number.isInteger(next) ? next : revision.value + 1;
    });
  }

  if (typeof window === "object") {
    window.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerEnd, { capture: true, passive: true });
    window.addEventListener("pointercancel", handlePointerCancel, { capture: true, passive: true });
  }

  stopSwipeClassWatch = watch(
    swipeNavigationEnabled,
    (enabled) => {
      if (typeof document !== "object") {
        return;
      }
      document.documentElement.classList.toggle("shell-route-swipe-enabled", enabled);
    },
    { immediate: true }
  );
});

onBeforeUnmount(() => {
  if (typeof unsubscribe === "function") {
    unsubscribe();
    unsubscribe = null;
  }
  if (typeof stopSwipeClassWatch === "function") {
    stopSwipeClassWatch();
    stopSwipeClassWatch = null;
  }
  if (typeof document === "object") {
    document.documentElement.classList.remove("shell-route-swipe-enabled");
  }
  if (typeof window === "object") {
    window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    window.removeEventListener("pointermove", handlePointerMove, { capture: true });
    window.removeEventListener("pointerup", handlePointerEnd, { capture: true });
    window.removeEventListener("pointercancel", handlePointerCancel, { capture: true });
  }
});

const resolvedLayoutClass = computed(() => {
  const displayName = String(display?.name?.value || "").trim().toLowerCase();
  if (displayName === "xs" || displayName === "sm") {
    return "compact";
  }
  if (displayName === "md") {
    return "medium";
  }
  return "expanded";
});

const currentPathname = computed(() =>
  normalizeComparablePathname(resolveRuntimePathname(route?.path || route?.fullPath || "/"))
);

const currentSurfaceId = computed(() => {
  const contextValue = placementContext?.value || null;
  const surfaceFromPathname = resolveSurfaceIdFromPlacementPathname(contextValue, currentPathname.value);
  if (surfaceFromPathname) {
    return surfaceFromPathname;
  }

  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  return surfaceConfig.defaultSurfaceId || "*";
});

const primaryNavEntries = computed(() => {
  void revision.value;
  const contextValue = placementContext?.value || null;
  const routeParams = route?.params || {};

  return placementRuntime
    .getPlacements({
      surface: currentSurfaceId.value,
      target: props.target,
      layoutClass: "compact"
    })
    .filter((entry) => String(entry.semanticTarget || entry.target || "").trim() === props.semanticTarget)
    .map((entry, index) => {
      const entryProps = entry?.props && typeof entry.props === "object" ? entry.props : {};
      const target = resolveMenuLinkTarget({
        to: entryProps.to,
        surface: entryProps.surface,
        currentSurfaceId: currentSurfaceId.value,
        placementContext: contextValue,
        scopedSuffix: entryProps.scopedSuffix,
        unscopedSuffix: entryProps.unscopedSuffix,
        routeParams,
        resolvePagePath(relativePath, options = {}) {
          return resolveShellLinkPath({
            context: contextValue,
            surface: options.surface,
            relativePath,
            params: routeParams,
            strictParams: options.strictParams !== false
          });
        }
      });
      const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(contextValue, {
        path: target,
        surfaceId: entryProps.surface || currentSurfaceId.value
      });

      return Object.freeze({
        id: entry.id,
        index,
        exact: entryProps.exact === true,
        href: navigationTarget.href,
        pathname: normalizeComparablePathname(navigationTarget.href),
        sameOrigin: navigationTarget.sameOrigin
      });
    })
    .filter((entry) => entry.pathname && entry.sameOrigin);
});

const activePrimaryNavIndex = computed(() => {
  const pathname = currentPathname.value;
  let bestMatch = null;

  for (const entry of primaryNavEntries.value) {
    if (!pathMatchesNavigationEntry(pathname, entry)) {
      continue;
    }
    if (!bestMatch || entry.pathname.length > bestMatch.pathname.length) {
      bestMatch = entry;
    }
  }

  return bestMatch ? bestMatch.index : -1;
});

watch(
  activePrimaryNavIndex,
  (nextIndex, previousIndex) => {
    if (
      !Number.isInteger(previousIndex) ||
      previousIndex < 0 ||
      nextIndex < 0 ||
      nextIndex === previousIndex
    ) {
      transitionDirection.value = "none";
      return;
    }

    transitionDirection.value = nextIndex > previousIndex ? "forward" : "reverse";
  },
  { flush: "sync" }
);

const routeTransitionName = computed(() => {
  if (!props.enabled || resolvedLayoutClass.value !== "compact") {
    return "";
  }
  if (transitionDirection.value === "forward") {
    return "shell-route-slide-forward";
  }
  if (transitionDirection.value === "reverse") {
    return "shell-route-slide-reverse";
  }
  return "";
});

const routeTransitionKey = computed(() => normalizeComparablePathname(route?.path || route?.fullPath || "/") || "/");

const swipeNavigationEnabled = computed(() =>
  Boolean(
    props.enabled &&
    props.swipeEnabled &&
    resolvedLayoutClass.value === "compact" &&
    primaryNavEntries.value.length > 1 &&
    activePrimaryNavIndex.value >= 0
  )
);

function handlePointerDown(event) {
  if (!swipeNavigationEnabled.value || !isPrimaryPointerEvent(event) || isSwipeIgnoredTarget(event.target)) {
    activeSwipe = null;
    return;
  }

  activeSwipe = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startTime: performance.now(),
    cancelled: false
  };
  try {
    event.target?.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic test events and some embedded webviews may not expose an active pointer.
  }
}

function handlePointerMove(event) {
  if (!activeSwipe || event.pointerId !== activeSwipe.pointerId) {
    return;
  }

  const deltaX = event.clientX - activeSwipe.startX;
  const deltaY = event.clientY - activeSwipe.startY;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absY > SWIPE_MAX_VERTICAL_DRIFT || (absY > 28 && absY > absX * 1.3)) {
    activeSwipe.cancelled = true;
    return;
  }

  if (absX > 10 && absX > absY) {
    event.preventDefault();
  }

  if (isAcceptedSwipe({ deltaX, deltaY, elapsed: Math.max(performance.now() - activeSwipe.startTime, 1) })) {
    const offset = deltaX < 0 ? 1 : -1;
    activeSwipe = null;
    navigateBySwipe(offset);
  }
}

function handlePointerEnd(event) {
  if (!activeSwipe || event.pointerId !== activeSwipe.pointerId) {
    return;
  }

  const swipe = activeSwipe;
  activeSwipe = null;

  if (swipe.cancelled || !swipeNavigationEnabled.value) {
    return;
  }

  const deltaX = event.clientX - swipe.startX;
  const deltaY = event.clientY - swipe.startY;
  const elapsed = Math.max(performance.now() - swipe.startTime, 1);
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const velocity = absX / elapsed;

  if (!isAcceptedSwipe({ deltaX, deltaY, elapsed, velocity })) {
    return;
  }

  navigateBySwipe(deltaX < 0 ? 1 : -1);
}

function handlePointerCancel(event) {
  if (activeSwipe && event.pointerId === activeSwipe.pointerId) {
    activeSwipe = null;
  }
}

function navigateBySwipe(offset = 0) {
  const currentIndex = activePrimaryNavIndex.value;
  const nextEntry = primaryNavEntries.value[currentIndex + offset];
  if (!nextEntry?.href || normalizeComparablePathname(nextEntry.href) === currentPathname.value) {
    return;
  }

  void router.push(nextEntry.href).catch(() => {});
}

function isAcceptedSwipe({ deltaX = 0, deltaY = 0, elapsed = 1, velocity = null } = {}) {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const resolvedVelocity = velocity == null ? absX / Math.max(elapsed, 1) : velocity;
  return Boolean(
    absX >= SWIPE_MIN_DISTANCE &&
    absY <= SWIPE_MAX_VERTICAL_DRIFT &&
    absX > absY &&
    resolvedVelocity >= SWIPE_MIN_VELOCITY
  );
}

function normalizeComparablePathname(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.origin !== window.location.origin) {
      return "";
    }
    return normalizePathname(parsed.pathname);
  } catch {
    return normalizePathname(normalizeMenuLinkPathname(raw));
  }
}

function pathMatchesNavigationEntry(pathname = "", entry = {}) {
  const target = String(entry.pathname || "").trim();
  if (!target) {
    return false;
  }
  if (entry.exact || target === "/") {
    return pathname === target;
  }
  return pathname === target || pathname.startsWith(`${target}/`);
}

function isPrimaryPointerEvent(event) {
  return event?.isPrimary !== false && event?.button === 0 && event?.pointerType !== "mouse";
}

function isSwipeIgnoredTarget(target) {
  return Boolean(
    target?.closest?.(
      [
        "a",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        "[role='button']",
        "[role='link']",
        "[role='slider']",
        "[contenteditable='true']",
        "[data-shell-swipe-ignore]"
      ].join(",")
    )
  );
}
</script>

<template>
  <div class="shell-route-transition">
    <Transition :name="routeTransitionName" :css="Boolean(routeTransitionName)">
      <div :key="routeTransitionKey" class="shell-route-transition__pane">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.shell-route-transition {
  --shell-route-transition-distance: 100%;
  --shell-route-transition-opacity: 1;
  overflow-x: clip;
  position: relative;
}

:global(.shell-route-swipe-enabled) {
  touch-action: pan-y;
}

.shell-route-transition__pane {
  background: rgb(var(--v-theme-background));
  width: 100%;
}

.shell-route-slide-forward-enter-active,
.shell-route-slide-forward-leave-active,
.shell-route-slide-reverse-enter-active,
.shell-route-slide-reverse-leave-active {
  transition:
    transform 320ms cubic-bezier(0.2, 0, 0, 1),
    opacity 120ms linear;
}

.shell-route-slide-forward-leave-active,
.shell-route-slide-reverse-leave-active {
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  width: 100%;
}

.shell-route-slide-forward-enter-from {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(var(--shell-route-transition-distance));
}

.shell-route-slide-forward-leave-to {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(calc(var(--shell-route-transition-distance) * -1));
}

.shell-route-slide-reverse-enter-from {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(calc(var(--shell-route-transition-distance) * -1));
}

.shell-route-slide-reverse-leave-to {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(var(--shell-route-transition-distance));
}

@media (prefers-reduced-motion: reduce) {
  .shell-route-slide-forward-enter-active,
  .shell-route-slide-forward-leave-active,
  .shell-route-slide-reverse-enter-active,
  .shell-route-slide-reverse-leave-active {
    transition-duration: 1ms;
  }

  .shell-route-slide-forward-enter-from,
  .shell-route-slide-forward-leave-to,
  .shell-route-slide-reverse-enter-from,
  .shell-route-slide-reverse-leave-to {
    transform: none;
  }
}
</style>
