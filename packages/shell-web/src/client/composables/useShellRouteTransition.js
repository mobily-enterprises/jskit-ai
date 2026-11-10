import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import {
  useWebPlacementContext,
  useWebPlacementRevision,
  useWebPlacementRuntime
} from "../placement/inject.js";
import { resolveRuntimePathname } from "../placement/pathname.js";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceIdFromPlacementPathname
} from "../placement/surfaceContext.js";
import {
  normalizeComparablePathname,
  resolveActivePrimaryNavigationIndex,
  resolvePrimaryNavigationEntries
} from "../support/primaryNavigation.js";
import { resolveShellRouteTransitionKey } from "../support/routeTransitionKey.js";
import { createRouteSwipeGesture } from "../support/routeSwipeGesture.js";
import { isPrimaryTouchPointer, isShellGestureIgnoredTarget } from "../support/gestureTargets.js";
import { resolveShellLayoutClass } from "../support/shellLayoutClass.js";

/**
 * Compact-layout route motion and swipes between primary navigation destinations.
 * @param {object} props
 * @param {boolean} props.enabled
 * @param {string} props.target The outlet whose placements are the destinations.
 * @param {string} props.semanticTarget
 * @param {boolean} props.swipeEnabled
 */
function useShellRouteTransition(props) {
  const route = useRoute();
  const router = useRouter();
  const display = useDisplay();
  const placementRuntime = useWebPlacementRuntime();
  const { context: placementContext } = useWebPlacementContext();
  const revision = useWebPlacementRevision(placementRuntime);
  const transitionDirection = ref("none");
  const swipeGesture = createRouteSwipeGesture();
  let stopSwipeClassWatch = null;

  onMounted(() => {
    window.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerEnd, { capture: true, passive: true });
    window.addEventListener("pointercancel", handlePointerCancel, { capture: true, passive: true });

    stopSwipeClassWatch = watch(
      swipeNavigationEnabled,
      (enabled) => {
        document.documentElement.classList.toggle("shell-route-swipe-enabled", enabled);
      },
      { immediate: true }
    );
  });

  onBeforeUnmount(() => {
    if (stopSwipeClassWatch) {
      stopSwipeClassWatch();
      stopSwipeClassWatch = null;
    }
    document.documentElement.classList.remove("shell-route-swipe-enabled");
    window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    window.removeEventListener("pointermove", handlePointerMove, { capture: true });
    window.removeEventListener("pointerup", handlePointerEnd, { capture: true });
    window.removeEventListener("pointercancel", handlePointerCancel, { capture: true });
  });

  const resolvedLayoutClass = computed(() => resolveShellLayoutClass(display.width.value));

  const currentPathname = computed(() => normalizeComparablePathname(resolveRuntimePathname(route.path)));

  const currentSurfaceId = computed(() => {
    const contextValue = placementContext.value;
    const surfaceFromPathname = resolveSurfaceIdFromPlacementPathname(contextValue, currentPathname.value);
    if (surfaceFromPathname) {
      return surfaceFromPathname;
    }

    const surfaceConfig = readPlacementSurfaceConfig(contextValue);
    return surfaceConfig.defaultSurfaceId || "*";
  });

  const primaryNavEntries = computed(() => {
    void revision.value;

    const placements = placementRuntime.getPlacements({
      surface: currentSurfaceId.value,
      target: props.target,
      layoutClass: "compact"
    });
    return resolvePrimaryNavigationEntries(placements, {
      semanticTarget: props.semanticTarget,
      currentSurfaceId: currentSurfaceId.value,
      currentPathname: currentPathname.value,
      placementContext: placementContext.value,
      routeParams: route.params
    });
  });

  const activePrimaryNavIndex = computed(() =>
    resolveActivePrimaryNavigationIndex(currentPathname.value, primaryNavEntries.value)
  );

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

  // Animation can change with viewport geometry; pane identity changes only with
  // navigation. Resizing must not recreate the routed form or lose focus.
  const routeTransitionKey = ref("");
  watch(
    [() => normalizeComparablePathname(route.path), currentSurfaceId],
    ([routePathKey, surfaceId]) => {
      routeTransitionKey.value = resolveShellRouteTransitionKey({
        routePathKey,
        routeTransitionName: routeTransitionName.value,
        surfaceId
      });
    },
    { immediate: true, flush: "sync" }
  );

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
    if (!swipeNavigationEnabled.value || !isPrimaryTouchPointer(event) || isShellGestureIgnoredTarget(event.target)) {
      swipeGesture.reset();
      return;
    }

    swipeGesture.start(event);
    try {
      event.target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events and some embedded webviews may not expose an active pointer.
    }
  }

  function handlePointerMove(event) {
    const { claim, offset } = swipeGesture.move(event);
    if (claim) {
      event.preventDefault();
    }
    if (offset) {
      navigateBySwipe(offset);
    }
  }

  function handlePointerEnd(event) {
    const offset = swipeGesture.end(event);
    if (offset && swipeNavigationEnabled.value) {
      navigateBySwipe(offset);
    }
  }

  function handlePointerCancel(event) {
    swipeGesture.cancel(event);
  }

  function navigateBySwipe(offset = 0) {
    const currentIndex = activePrimaryNavIndex.value;
    const nextEntry = primaryNavEntries.value[currentIndex + offset];
    if (!nextEntry?.href || normalizeComparablePathname(nextEntry.href) === currentPathname.value) {
      return;
    }

    void router.push(nextEntry.href).catch(() => {});
  }

  return {
    routeTransitionKey,
    routeTransitionName
  };
}

export { useShellRouteTransition };
