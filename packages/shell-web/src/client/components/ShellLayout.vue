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
import { useShellLayoutState } from "../composables/useShellLayoutState.js";
import {
  resolveShellDrawerPresentation,
  resolveShellDrawerToggleLabel
} from "../support/drawerPresentation.js";
import {
  DEFAULT_SHELL_DRAWER_WIDTH,
  DEFAULT_SHELL_NAVIGATION_ITEM_SPACING,
  DEFAULT_SHELL_RAIL_WIDTH,
  normalizeShellDrawerWidth,
  normalizeShellNavigationItemSpacing,
  normalizeShellRailWidth,
  resolveContentAwareDrawerWidth
} from "../support/drawerWidth.js";
import ShellOutlet from "./ShellOutlet.vue";
import ShellRouteTransition from "./ShellRouteTransition.vue";

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
  desktopDrawerClosedMode: {
    type: String,
    default: "rail"
  },
  drawerWidth: {
    type: Number,
    default: null
  },
  railWidth: {
    type: Number,
    default: DEFAULT_SHELL_RAIL_WIDTH
  },
  navigationItemSpacing: {
    type: Number,
    default: DEFAULT_SHELL_NAVIGATION_ITEM_SPACING
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
  toggleDrawer,
  resolvedSurface,
  resolvedSurfaceLabel
} = useShellLayoutState(props);
const display = useDisplay();
const refreshRuntime = inject("jskit.shell-web.runtime.web-refresh.client", null);
const pullDistance = ref(0);
const pullRefreshing = ref(false);
const wideDrawerOpen = ref(Boolean(drawerDefaultOpen.value));
const navigationToggle = ref(null);
const navigationDrawer = ref(null);
const measuredDrawerWidth = ref(DEFAULT_SHELL_DRAWER_WIDTH);
let activePull = null;
let drawerContentObserver = null;
let drawerMeasurementFrame = null;
let shellMounted = false;

const PULL_REFRESH_TRIGGER_DISTANCE = 72;
const PULL_REFRESH_MAX_DISTANCE = 112;

const layoutClass = computed(() => {
  const displayName = String(display?.name?.value || "").trim().toLowerCase();
  if (displayName === "xs" || displayName === "sm") {
    return "compact";
  }
  if (displayName === "md") {
    return "medium";
  }
  return "expanded";
});
const isCompactLayout = computed(() => layoutClass.value === "compact");
const drawerPresentation = computed(() => resolveShellDrawerPresentation({
  compact: isCompactLayout.value,
  open: drawerOpen.value,
  desktopClosedMode: props.desktopDrawerClosedMode
}));
const drawerToggleLabel = computed(() => resolveShellDrawerToggleLabel({
  compact: isCompactLayout.value,
  open: drawerOpen.value
}));
const resolvedDrawerWidth = computed(() => {
  if (props.drawerWidth !== null && props.drawerWidth !== undefined) {
    return normalizeShellDrawerWidth(props.drawerWidth);
  }
  return normalizeShellDrawerWidth(measuredDrawerWidth.value);
});
const resolvedRailWidth = computed(() => normalizeShellRailWidth(props.railWidth));
const resolvedNavigationItemSpacing = computed(() =>
  normalizeShellNavigationItemSpacing(props.navigationItemSpacing)
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
  drawerOpen,
  handleDrawerOpenChange
);

watch(
  isCompactLayout,
  handleLayoutClassChange,
  { immediate: true }
);

watch(drawerPresentation, scheduleDrawerWidthMeasurement, { flush: "post" });
watch(resolvedSurface, scheduleDrawerWidthMeasurement, { flush: "post" });
watch(resolvedNavigationItemSpacing, scheduleDrawerWidthMeasurement, { flush: "post" });

onMounted(attachShellListeners);
onBeforeUnmount(detachShellListeners);

function attachShellListeners() {
  shellMounted = true;
  if (typeof window !== "object") {
    return;
  }

  window.addEventListener("keydown", handleShellKeydown);
  window.addEventListener("resize", scheduleDrawerWidthMeasurement, { passive: true });
  window.addEventListener("pointerdown", handlePullPointerDown, { capture: true, passive: true });
  window.addEventListener("pointermove", handlePullPointerMove, { capture: true, passive: false });
  window.addEventListener("pointerup", handlePullPointerEnd, { capture: true, passive: true });
  window.addEventListener("pointercancel", handlePullPointerCancel, { capture: true, passive: true });
  window.addEventListener("touchstart", handlePullTouchStart, { capture: true, passive: true });
  window.addEventListener("touchmove", handlePullTouchMove, { capture: true, passive: false });
  window.addEventListener("touchend", handlePullTouchEnd, { capture: true, passive: true });
  window.addEventListener("touchcancel", handlePullTouchCancel, { capture: true, passive: true });

  if (document?.fonts) {
    void document.fonts.ready.then(scheduleDrawerWidthMeasurement);
    document.fonts.addEventListener?.("loadingdone", scheduleDrawerWidthMeasurement);
  }
  void nextTick().then(initializeDrawerMeasurement);
}

function detachShellListeners() {
  shellMounted = false;
  if (typeof window !== "object") {
    return;
  }

  window.removeEventListener("keydown", handleShellKeydown);
  window.removeEventListener("resize", scheduleDrawerWidthMeasurement);
  window.removeEventListener("pointerdown", handlePullPointerDown, { capture: true });
  window.removeEventListener("pointermove", handlePullPointerMove, { capture: true });
  window.removeEventListener("pointerup", handlePullPointerEnd, { capture: true });
  window.removeEventListener("pointercancel", handlePullPointerCancel, { capture: true });
  window.removeEventListener("touchstart", handlePullTouchStart, { capture: true });
  window.removeEventListener("touchmove", handlePullTouchMove, { capture: true });
  window.removeEventListener("touchend", handlePullTouchEnd, { capture: true });
  window.removeEventListener("touchcancel", handlePullTouchCancel, { capture: true });
  document?.fonts?.removeEventListener?.("loadingdone", scheduleDrawerWidthMeasurement);
  drawerContentObserver?.disconnect();
  drawerContentObserver = null;
  if (drawerMeasurementFrame !== null) {
    window.cancelAnimationFrame(drawerMeasurementFrame);
    drawerMeasurementFrame = null;
  }
}

function handleDrawerOpenChange(open) {
  if (!isCompactLayout.value) {
    wideDrawerOpen.value = Boolean(open);
  }
}

function handleLayoutClassChange(compact) {
  setDrawerOpen(compact ? false : wideDrawerOpen.value);
}

function handleShellKeydown(event) {
  if (
    event?.defaultPrevented ||
    event?.key !== "Escape" ||
    !isCompactLayout.value ||
    !drawerOpen.value
  ) {
    return;
  }

  event.preventDefault();
  setDrawerOpen(false);
  void nextTick().then(focusNavigationToggle);
}

function focusNavigationToggle() {
  const toggleElement = navigationToggle.value?.$el || navigationToggle.value;
  toggleElement?.focus?.({ preventScroll: true });
}

function initializeDrawerMeasurement() {
  const drawerElement = resolveNavigationDrawerElement();
  const drawerContent = drawerElement?.querySelector?.(".v-navigation-drawer__content") || drawerElement;
  if (typeof MutationObserver === "function" && drawerContent) {
    drawerContentObserver?.disconnect();
    drawerContentObserver = new MutationObserver(scheduleDrawerWidthMeasurement);
    drawerContentObserver.observe(drawerContent, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
  scheduleDrawerWidthMeasurement();
}

function resolveNavigationDrawerElement() {
  const exposedElement = navigationDrawer.value?.$el || navigationDrawer.value || null;
  if (typeof exposedElement?.getBoundingClientRect === "function") {
    return exposedElement;
  }
  if (typeof document === "object") {
    return document.getElementById("jskit-shell-drawer");
  }
  return null;
}

function scheduleDrawerWidthMeasurement() {
  if (
    !shellMounted ||
    props.drawerWidth !== null && props.drawerWidth !== undefined ||
    !drawerPresentation.value.visible ||
    drawerPresentation.value.rail ||
    typeof window !== "object"
  ) {
    return;
  }

  if (drawerMeasurementFrame !== null) {
    window.cancelAnimationFrame(drawerMeasurementFrame);
  }
  drawerMeasurementFrame = window.requestAnimationFrame(measureDrawerContentWidth);
}

function measureDrawerContentWidth() {
  drawerMeasurementFrame = null;
  const drawerElement = resolveNavigationDrawerElement();
  if (!drawerElement || typeof document !== "object") {
    return;
  }

  const drawerRect = drawerElement.getBoundingClientRect();
  const drawerStyle = window.getComputedStyle(drawerElement);
  const rightToLeft = drawerStyle.direction === "rtl";
  const endBorderWidth = Number.parseFloat(
    rightToLeft ? drawerStyle.borderLeftWidth : drawerStyle.borderRightWidth
  ) || 0;
  const measurements = [];

  for (const label of drawerElement.querySelectorAll(".v-list-item-title")) {
    const labelStyle = window.getComputedStyle(label);
    if (labelStyle.display === "none" || labelStyle.visibility === "hidden") {
      continue;
    }
    const textRect = measureRenderedText(label);
    if (!textRect || textRect.width <= 0) {
      continue;
    }
    measurements.push({
      logicalStart: rightToLeft
        ? drawerRect.right - textRect.right
        : textRect.left - drawerRect.left,
      textWidth: textRect.width
    });
  }

  const nextWidth = resolveContentAwareDrawerWidth(measurements, {
    endGap: resolvedNavigationItemSpacing.value + endBorderWidth
  });
  if (Math.abs(nextWidth - measuredDrawerWidth.value) >= 0.25) {
    measuredDrawerWidth.value = nextWidth;
  }
}

function measureRenderedText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  range.detach?.();
  return rect;
}

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

function handleDrawerVisibilityChange(open) {
  if (isCompactLayout.value || drawerPresentation.value.closedMode === "hidden" || open === false) {
    setDrawerOpen(open);
  }
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
    <v-app-bar-nav-icon
      ref="navigationToggle"
      class="shell-layout__nav-toggle"
      data-testid="jskit-shell-nav-toggle"
      :aria-label="drawerToggleLabel"
      :aria-expanded="drawerOpen"
      aria-controls="jskit-shell-drawer"
      @click="toggleDrawer"
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
    ref="navigationDrawer"
    id="jskit-shell-drawer"
    :model-value="drawerPresentation.visible"
    border
    class="shell-layout__drawer bg-surface"
    data-testid="jskit-shell-drawer"
    :data-layout="layoutClass"
    :data-presentation="drawerPresentation.kind"
    :data-drawer-width-mode="props.drawerWidth === null || props.drawerWidth === undefined ? 'content' : 'fixed'"
    :data-drawer-width="resolvedDrawerWidth"
    :data-navigation-item-spacing="resolvedNavigationItemSpacing"
    :data-rail-width="resolvedRailWidth"
    :style="{ '--shell-navigation-item-spacing': `${resolvedNavigationItemSpacing}px` }"
    :temporary="isCompactLayout"
    :permanent="!isCompactLayout"
    :width="resolvedDrawerWidth"
    :rail="drawerPresentation.rail"
    :rail-width="resolvedRailWidth"
    @update:model-value="handleDrawerVisibilityChange"
  >
    <slot name="menu" :surface="resolvedSurface" :rail="drawerPresentation.rail">
      <v-list
        nav
        density="comfortable"
        class="pt-2"
        :prepend-gap="resolvedNavigationItemSpacing"
      >
        <v-list-subheader v-if="!drawerPresentation.rail" class="text-uppercase text-caption">
          {{ resolvedSurfaceLabel }}
        </v-list-subheader>
        <ShellOutlet
          target="shell-layout:primary-menu"
          default
        />
        <v-divider class="my-2" />
        <ShellOutlet target="shell-layout:secondary-menu" />
      </v-list>
    </slot>
  </v-navigation-drawer>

  <v-main class="bg-background">
    <v-container fluid class="shell-layout__content">
      <h1 v-if="title" class="shell-layout__title text-h5">{{ title }}</h1>
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
    mandatory
  >
    <ShellOutlet target="shell-layout:primary-bottom-nav" />
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

  <v-navigation-drawer
    v-if="!isCompactLayout"
    :model-value="supportingContentOpen"
    border
    temporary
    location="right"
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

.shell-layout__nav-toggle {
  min-height: 48px;
  min-width: 48px;
}

.shell-layout__drawer :deep(.v-list-item-title) {
  white-space: nowrap;
}

.shell-layout__drawer[data-presentation="drawer"] :deep(.v-list--nav),
.shell-layout__drawer[data-presentation="drawer"] :deep(.v-list-item) {
  padding-inline-end: calc(var(--shell-navigation-item-spacing) / 2);
}

.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item) {
  grid-template-areas: "prepend";
  grid-template-columns: minmax(0, 1fr);
  inline-size: 100%;
  min-height: 48px;
  min-width: 48px;
  padding-inline: 0;
}

.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item__prepend) {
  inline-size: 100%;
  justify-content: center;
  min-width: 0;
}

.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item__prepend .v-list-item__spacer),
.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item__content),
.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item__append) {
  display: none;
}

.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item__overlay) {
  border-radius: 999px;
  inset-block: 8px;
  inset-inline: 4px;
}

.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item--active > .v-list-item__overlay) {
  background: color-mix(
    in srgb,
    rgb(var(--v-theme-primary)) 18%,
    rgb(var(--v-theme-surface))
  );
  opacity: 1;
}

.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item--active .v-icon) {
  color: rgb(var(--v-theme-primary));
  opacity: 1;
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
