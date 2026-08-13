<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { useDisplay } from "vuetify";
import { useRoute } from "vue-router";
import { mdiDotsHorizontal } from "@mdi/js";
import { useJskitNavigation } from "@jskit-ai/kernel/client/navigation";
import { useShellLayoutState } from "../composables/useShellLayoutState.js";
import ShellOutlet from "./ShellOutlet.vue";
import ShellRouteTransition from "./ShellRouteTransition.vue";
import ShellLeadingNavigation from "./ShellLeadingNavigation.vue";
import ShellNavigationGuardDialog from "./ShellNavigationGuardDialog.vue";
import ShellSurfaceAwareMenuLinkItem from "./ShellSurfaceAwareMenuLinkItem.vue";
import { resolveMaterialWindowClass } from "../support/materialWindowClass.js";

const props = defineProps({
  surface: {
    type: String,
    default: ""
  },
  surfaceLabel: {
    type: String,
    default: ""
  },
  title: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  },
  navigationLabels: {
    type: Object,
    default: () => ({})
  }
});

const {
  drawerDefaultOpen,
  drawerOpen,
  setDrawerOpen,
  supportingContentOpen,
  supportingContentTitle,
  setSupportingContentOpen,
  closeSupportingContent,
  resolvedSurface,
  resolvedSurfaceLabel
} = useShellLayoutState(props);
const display = useDisplay();
const route = useRoute();
const navigation = useJskitNavigation();
const refreshRuntime = inject("jskit.shell-web.runtime.web-refresh.client", null);
const pullDistance = ref(0);
const pullRefreshing = ref(false);
const navigationOverflowOpen = ref(false);
const moreNavigationButton = ref(null);
let activePull = null;
let moreNavigationRoute = "";
let restoreMoreNavigationFocus = false;
const unregisterShellOverlay = navigation.registerTransientLayer({
  id: "shell.web.overlay",
  priority: 100,
  isOpen: () => Boolean(navigationOverflowOpen.value || drawerOpen.value || supportingContentOpen.value),
  close: () => closeTopShellOverlay()
});

const PULL_REFRESH_TRIGGER_DISTANCE = 72;
const PULL_REFRESH_MAX_DISTANCE = 112;
const COMPACT_NAVIGATION_CAPACITY = 5;
const RAIL_NAVIGATION_CAPACITY = 7;

function navigationLabel(key, fallback) {
  return String(props.navigationLabels?.[key] || fallback).trim() || fallback;
}

const layoutClass = computed(() => {
  return resolveMaterialWindowClass(display?.width?.value);
});
const isCompactLayout = computed(() => layoutClass.value === "compact");
const isMediumLayout = computed(() => layoutClass.value === "medium");
const isExpandedLayout = computed(() => layoutClass.value === "expanded");
const navigationRail = computed(() =>
  Boolean(isMediumLayout.value || (isExpandedLayout.value && !drawerDefaultOpen.value))
);
const pullProgress = computed(() =>
  Math.min(100, Math.round((pullDistance.value / PULL_REFRESH_TRIGGER_DISTANCE) * 100))
);
const pullIndicatorVisible = computed(() =>
  Boolean(isCompactLayout.value && (pullDistance.value > 0 || pullRefreshing.value))
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

watch(
  layoutClass,
  () => {
    setDrawerOpen(false);
    navigationOverflowOpen.value = false;
  },
  { immediate: true }
);

watch(
  () => route.fullPath,
  () => {
    setDrawerOpen(false);
    navigationOverflowOpen.value = false;
    restoreMoreNavigationFocus = false;
  }
);

watch(
  [drawerOpen, navigationOverflowOpen],
  async ([drawerIsOpen, overflowIsOpen], [previousDrawerOpen, previousOverflowOpen]) => {
    const closed = (previousDrawerOpen || previousOverflowOpen) && !drawerIsOpen && !overflowIsOpen;
    if (!closed || !restoreMoreNavigationFocus || route.fullPath !== moreNavigationRoute) {
      return;
    }
    restoreMoreNavigationFocus = false;
    await nextTick();
    const target = moreNavigationButton.value?.$el || moreNavigationButton.value;
    target?.focus?.();
  }
);

function setPrimaryNavigationOpen(open) {
  if (isCompactLayout.value) {
    setDrawerOpen(open);
  }
}

function openPrimaryNavigation() {
  setDrawerOpen(true);
}

function openMoreNavigation() {
  moreNavigationRoute = route.fullPath;
  restoreMoreNavigationFocus = true;
  if (isCompactLayout.value) {
    setDrawerOpen(true);
    return;
  }
  navigationOverflowOpen.value = true;
}

function closeTopShellOverlay() {
  if (navigationOverflowOpen.value) {
    navigationOverflowOpen.value = false;
    return true;
  }
  if (drawerOpen.value) {
    setDrawerOpen(false);
    return true;
  }
  if (supportingContentOpen.value) {
    closeSupportingContent();
    return true;
  }
  return false;
}

function handleShellEscape(event) {
  if (event?.key !== "Escape" || event.defaultPrevented || !closeTopShellOverlay()) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function hasNavigationOverflow(primary = [], secondary = [], capacity) {
  return primary.length > capacity || secondary.length > 0;
}

function visiblePrimaryNavigation(primary = [], secondary = [], capacity) {
  const visibleCount = hasNavigationOverflow(primary, secondary, capacity) ? capacity - 1 : capacity;
  return primary.slice(0, visibleCount);
}

function hiddenPrimaryNavigation(primary = [], capacity) {
  return primary.slice(Math.max(0, capacity - 1));
}

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
  window.addEventListener("keydown", handleShellEscape);
});

onBeforeUnmount(() => {
  unregisterShellOverlay();
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
  window.removeEventListener("keydown", handleShellEscape);
});

function handlePullPointerDown(event) {
  if (!canStartPullRefresh(event)) {
    activePull = null;
    return;
  }

  activePull = {
    pointerId: event.pointerId,
    touchIdentifier: null,
    startX: event.clientX,
    startY: event.clientY,
    pointerCancelled: false
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

function handlePullPointerCancel(event) {
  if (!activePull || event.pointerId !== activePull.pointerId) {
    return;
  }

  activePull.pointerId = null;
  activePull.pointerCancelled = true;
}

function handlePullTouchStart(event) {
  if (activePull || !canStartTouchPullRefresh(event)) {
    return;
  }

  const touch = event.touches?.[0] || null;
  if (!touch) {
    return;
  }

  activePull = {
    pointerId: null,
    touchIdentifier: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    pointerCancelled: false
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
  if (!refreshRuntime || typeof refreshRuntime.refresh !== "function" || pullRefreshing.value) {
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

function canStartPullRefresh(event) {
  return Boolean(
    canStartPullRefreshFromTarget(event.target) &&
    isPrimaryTouchPointer(event)
  );
}

function canStartTouchPullRefresh(event) {
  return Boolean(
    event?.touches?.length === 1 &&
    canStartPullRefreshFromTarget(event.target)
  );
}

function canStartPullRefreshFromTarget(target) {
  return Boolean(
    isCompactLayout.value &&
    refreshRuntime &&
    typeof refreshRuntime.refresh === "function" &&
    !pullRefreshing.value &&
    isAtPageTop() &&
    !isPullRefreshIgnoredTarget(target)
  );
}

function isPrimaryTouchPointer(event) {
  return event?.isPrimary !== false && event?.button === 0 && event?.pointerType !== "mouse";
}

function isAtPageTop() {
  if (typeof window !== "object" || typeof document !== "object") {
    return false;
  }

  const documentScrollTop = Number(document.documentElement?.scrollTop || 0);
  const bodyScrollTop = Number(document.body?.scrollTop || 0);
  return Math.max(Number(window.scrollY || 0), documentScrollTop, bodyScrollTop) <= 0;
}

function isPullRefreshIgnoredTarget(target) {
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
        "[data-shell-pull-refresh-ignore]",
        "[data-shell-swipe-ignore]"
      ].join(",")
    )
  );
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
</script>

<template>
  <v-app-bar
    border
    :density="isCompactLayout ? 'compact' : 'comfortable'"
    elevation="0"
    class="shell-layout__app-bar bg-surface"
    data-testid="jskit-shell-app-bar"
  >
    <ShellLeadingNavigation
      :menu-available="isCompactLayout"
      :back-label="navigationLabel('back', 'Back')"
      :menu-label="navigationLabel('openMenu', 'Open navigation menu')"
      @open-menu="openPrimaryNavigation"
    />

    <slot name="top-left" :surface="resolvedSurface">
      <div class="shell-layout__top-left d-flex align-center ga-2">
        <span class="shell-layout__surface-label">
          {{ resolvedSurfaceLabel }}
        </span>
        <ShellOutlet target="shell-layout:top-left" />
      </div>
    </slot>

    <v-spacer />

    <slot name="top-right" :surface="resolvedSurface">
      <div class="shell-layout__top-right d-flex align-center ga-2">
        <ShellOutlet target="shell-layout:top-right" />
      </div>
    </slot>
  </v-app-bar>

  <div
    v-if="pullIndicatorVisible"
    class="shell-layout__pull-refresh"
    :class="{ 'shell-layout__pull-refresh--refreshing': pullRefreshing }"
    :style="pullRefreshStyle"
    data-testid="jskit-shell-pull-refresh"
    aria-live="polite"
  >
    <v-progress-circular
      :model-value="pullProgress"
      :indeterminate="pullRefreshing"
      color="primary"
      size="22"
      width="3"
    />
    <span class="shell-layout__pull-refresh-label">{{ pullRefreshLabel }}</span>
  </div>

  <v-navigation-drawer
    :model-value="isCompactLayout ? drawerOpen : true"
    border
    class="bg-surface"
    id="jskit-shell-primary-navigation"
    data-testid="jskit-shell-drawer"
    :temporary="isCompactLayout"
    :permanent="!isCompactLayout"
    :rail="navigationRail"
    :rail-width="88"
    :width="280"
    tag="nav"
    :aria-label="navigationLabel('primaryNavigation', 'Primary navigation')"
    @update:model-value="setPrimaryNavigationOpen"
  >
    <slot name="menu" :surface="resolvedSurface">
      <v-list v-if="isCompactLayout" nav density="comfortable" class="pt-2">
        <v-list-subheader class="text-uppercase text-caption">{{ resolvedSurfaceLabel }}</v-list-subheader>
        <ShellOutlet semantic-target="shell.primary-nav" v-slot="{ placements }">
          <ShellSurfaceAwareMenuLinkItem
            v-for="entry in placements"
            :key="entry.id"
            v-bind="entry.props"
          />
        </ShellOutlet>
        <ShellOutlet semantic-target="shell.secondary-nav" v-slot="{ placements }">
          <template v-if="placements.length">
            <v-divider class="my-2" />
            <ShellSurfaceAwareMenuLinkItem
              v-for="entry in placements"
              :key="entry.id"
              v-bind="entry.props"
            />
          </template>
        </ShellOutlet>
      </v-list>

      <ShellOutlet v-else-if="isMediumLayout" target="shell-layout:primary-rail" v-slot="{ placements: primaryPlacements }">
        <ShellOutlet semantic-target="shell.secondary-nav" v-slot="{ placements: secondaryPlacements }">
          <v-list nav class="shell-layout__rail-list" :aria-label="navigationLabel('primaryNavigation', 'Primary navigation')">
            <component
              :is="entry.component"
              v-for="entry in visiblePrimaryNavigation(primaryPlacements, secondaryPlacements, RAIL_NAVIGATION_CAPACITY)"
              :key="entry.id"
              v-bind="entry.props"
            />
            <v-list-item
              v-if="hasNavigationOverflow(primaryPlacements, secondaryPlacements, RAIL_NAVIGATION_CAPACITY)"
              ref="moreNavigationButton"
              :prepend-icon="mdiDotsHorizontal"
              :title="navigationLabel('more', 'More')"
              :aria-label="navigationLabel('openMore', 'Open more navigation')"
              :aria-expanded="navigationOverflowOpen ? 'true' : 'false'"
              aria-controls="jskit-shell-navigation-overflow"
              data-testid="jskit-shell-rail-more"
              @click="openMoreNavigation"
            />
          </v-list>
        </ShellOutlet>
      </ShellOutlet>

      <v-list v-else nav density="comfortable" class="pt-2" :aria-label="navigationLabel('primaryNavigation', 'Primary navigation')">
        <v-list-subheader class="text-uppercase text-caption">{{ resolvedSurfaceLabel }}</v-list-subheader>
        <ShellOutlet target="shell-layout:primary-drawer" default />
        <ShellOutlet target="shell-layout:secondary-menu" v-slot="{ placements }">
          <template v-if="placements.length">
            <v-divider class="my-2" />
            <component
              :is="entry.component"
              v-for="entry in placements"
              :key="entry.id"
              v-bind="entry.props"
            />
          </template>
        </ShellOutlet>
      </v-list>
    </slot>
  </v-navigation-drawer>

  <v-navigation-drawer
    v-if="isMediumLayout"
    v-model="navigationOverflowOpen"
    id="jskit-shell-navigation-overflow"
    border
    temporary
    tag="nav"
    :aria-label="navigationLabel('moreNavigation', 'More navigation')"
    :width="320"
    data-testid="jskit-shell-navigation-overflow"
  >
    <v-list nav density="comfortable" :aria-label="navigationLabel('moreNavigation', 'More navigation')">
      <v-list-subheader>{{ navigationLabel('more', 'More') }}</v-list-subheader>
      <ShellOutlet semantic-target="shell.primary-nav" v-slot="{ placements }">
        <ShellSurfaceAwareMenuLinkItem
          v-for="entry in hiddenPrimaryNavigation(placements, RAIL_NAVIGATION_CAPACITY)"
          :key="entry.id"
          v-bind="entry.props"
        />
      </ShellOutlet>
      <ShellOutlet semantic-target="shell.secondary-nav" v-slot="{ placements }">
        <v-divider v-if="placements.length" class="my-2" />
        <ShellSurfaceAwareMenuLinkItem
          v-for="entry in placements"
          :key="entry.id"
          v-bind="entry.props"
        />
      </ShellOutlet>
    </v-list>
  </v-navigation-drawer>

  <v-main class="bg-background">
    <v-container fluid class="shell-layout__content">
      <h1 v-if="title" class="shell-layout__title text-h5" data-jskit-page-heading>{{ title }}</h1>
      <p v-if="subtitle" class="shell-layout__subtitle text-body-2 text-medium-emphasis">{{ subtitle }}</p>
      <ShellRouteTransition>
        <slot />
      </ShellRouteTransition>
    </v-container>
  </v-main>

  <v-bottom-navigation
    v-if="isCompactLayout"
    class="shell-layout__bottom-nav"
    data-testid="jskit-shell-bottom-nav"
    bg-color="surface"
    color="primary"
    density="comfortable"
    grow
    tag="nav"
    :aria-label="navigationLabel('primaryNavigation', 'Primary navigation')"
  >
    <ShellOutlet target="shell-layout:primary-bottom-nav" v-slot="{ placements: primaryPlacements }">
      <ShellOutlet semantic-target="shell.secondary-nav" v-slot="{ placements: secondaryPlacements }">
        <component
          :is="entry.component"
          v-for="entry in visiblePrimaryNavigation(primaryPlacements, secondaryPlacements, COMPACT_NAVIGATION_CAPACITY)"
          :key="entry.id"
          v-bind="entry.props"
        />
        <v-btn
          v-if="hasNavigationOverflow(primaryPlacements, secondaryPlacements, COMPACT_NAVIGATION_CAPACITY)"
          ref="moreNavigationButton"
          class="shell-layout__bottom-more text-none"
          stacked
          :active="false"
          :aria-label="navigationLabel('openMore', 'Open more navigation')"
          :aria-expanded="drawerOpen ? 'true' : 'false'"
          aria-controls="jskit-shell-primary-navigation"
          data-testid="jskit-shell-bottom-more"
          @click="openMoreNavigation"
        >
          <v-icon :icon="mdiDotsHorizontal" />
          {{ navigationLabel('more', 'More') }}
        </v-btn>
      </ShellOutlet>
    </ShellOutlet>
  </v-bottom-navigation>

  <v-bottom-sheet
    v-if="isCompactLayout"
    :model-value="supportingContentOpen"
    @update:model-value="setSupportingContentOpen"
  >
    <v-card rounded="t-xl" class="shell-layout__supporting-sheet" data-testid="jskit-shell-supporting-bottom-sheet">
      <v-card-title class="shell-layout__supporting-title">
        <span>{{ supportingContentTitle || 'Details' }}</span>
        <v-btn variant="text" @click="closeSupportingContent">Close</v-btn>
      </v-card-title>
      <v-card-text>
        <ShellOutlet target="shell-layout:supporting-bottom-sheet" />
      </v-card-text>
    </v-card>
  </v-bottom-sheet>

  <ShellNavigationGuardDialog
    :stay-label="navigationLabel('stay', 'Stay')"
    :discard-label="navigationLabel('discardChanges', 'Discard changes')"
  />

  <v-navigation-drawer
    v-if="!isCompactLayout"
    :model-value="supportingContentOpen"
    border
    temporary
    location="end"
    :width="384"
    data-testid="jskit-shell-supporting-side-panel"
    @update:model-value="setSupportingContentOpen"
  >
    <div class="shell-layout__supporting-side-panel">
      <div class="shell-layout__supporting-title">
        <strong>{{ supportingContentTitle || 'Details' }}</strong>
        <v-btn variant="text" @click="closeSupportingContent">Close</v-btn>
      </div>
      <ShellOutlet target="shell-layout:supporting-side-panel" />
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.shell-layout__content {
  padding: 0.75rem 1rem calc(1rem + env(safe-area-inset-bottom, 0px));
}

.shell-layout__top-left,
.shell-layout__top-right {
  min-width: 0;
}

.shell-layout__top-right {
  max-width: min(45vw, 18rem);
  overflow: hidden;
}

.shell-layout__surface-label {
  color: rgb(var(--v-theme-on-surface));
  display: block;
  font-size: 0.95rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.2;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell-layout__title {
  margin-bottom: 0.25rem;
}

.shell-layout__subtitle {
  margin-bottom: 0.75rem;
}

.shell-layout__bottom-nav {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.shell-layout__bottom-more {
  flex: 0 0 auto;
  min-height: 48px;
  min-width: 72px;
}

.shell-layout__rail-list :deep(.v-btn) {
  min-height: 64px;
  min-width: 64px;
  width: 100%;
}

.shell-layout__rail-list :deep(.v-list-item) {
  min-height: 64px;
}

.shell-layout__app-bar :deep(.v-toolbar__content) {
  padding-inline-start: env(safe-area-inset-left, 0px);
  padding-inline-end: env(safe-area-inset-right, 0px);
}

.shell-layout__supporting-sheet {
  max-height: min(72vh, 40rem);
  overflow: auto;
}

.shell-layout__supporting-side-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.shell-layout__supporting-title {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.shell-layout__supporting-title :deep(.v-btn) {
  min-height: 48px;
}

.shell-layout__pull-refresh {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 999px;
  box-shadow: var(--v-shadow-3);
  display: flex;
  gap: 0.5rem;
  left: 50%;
  opacity: min(1, calc(var(--shell-pull-refresh-distance) / 56));
  padding: 0.45rem 0.75rem;
  pointer-events: none;
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 3.75rem);
  transform: translate3d(-50%, calc((var(--shell-pull-refresh-distance) - 72px) * 0.35), 0);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
  z-index: 2700;
}

.shell-layout__pull-refresh--refreshing {
  opacity: 1;
}

.shell-layout__pull-refresh-label {
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .shell-layout__content {
    padding-inline:
      calc(1px + env(safe-area-inset-left, 0px))
      calc(1px + env(safe-area-inset-right, 0px));
  }

  .shell-layout__surface-label {
    max-width: 8rem;
  }

  .shell-layout__top-right {
    max-width: 40vw;
  }
}
</style>
