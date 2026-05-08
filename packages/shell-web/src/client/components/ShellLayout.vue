<script setup>
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { useDisplay } from "vuetify";
import { useShellLayoutState } from "../composables/useShellLayoutState.js";
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
let activePull = null;

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
  isCompactLayout,
  (compact) => {
    setDrawerOpen(compact ? false : drawerDefaultOpen.value);
  },
  { immediate: true }
);

onMounted(() => {
  if (typeof window !== "object") {
    return;
  }

  window.addEventListener("pointerdown", handlePullPointerDown, { capture: true, passive: true });
  window.addEventListener("pointermove", handlePullPointerMove, { capture: true, passive: false });
  window.addEventListener("pointerup", handlePullPointerEnd, { capture: true, passive: true });
  window.addEventListener("pointercancel", handlePullPointerCancel, { capture: true, passive: true });
});

onBeforeUnmount(() => {
  if (typeof window !== "object") {
    return;
  }

  window.removeEventListener("pointerdown", handlePullPointerDown, { capture: true });
  window.removeEventListener("pointermove", handlePullPointerMove, { capture: true });
  window.removeEventListener("pointerup", handlePullPointerEnd, { capture: true });
  window.removeEventListener("pointercancel", handlePullPointerCancel, { capture: true });
});

function handlePullPointerDown(event) {
  if (!canStartPullRefresh(event)) {
    activePull = null;
    return;
  }

  activePull = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    cancelled: false
  };
}

function handlePullPointerMove(event) {
  if (!activePull || event.pointerId !== activePull.pointerId) {
    return;
  }

  const deltaX = event.clientX - activePull.startX;
  const deltaY = event.clientY - activePull.startY;
  const absX = Math.abs(deltaX);

  if (deltaY < -4 || (absX > 24 && absX > deltaY * 1.15)) {
    cancelPullRefresh();
    return;
  }

  if (deltaY <= 6 || !isAtPageTop()) {
    return;
  }

  event.preventDefault();
  pullDistance.value = Math.min(PULL_REFRESH_MAX_DISTANCE, Math.round(deltaY * 0.55));
}

function handlePullPointerEnd(event) {
  if (!activePull || event.pointerId !== activePull.pointerId) {
    return;
  }

  const shouldRefresh = pullDistance.value >= PULL_REFRESH_TRIGGER_DISTANCE;
  activePull = null;

  if (!shouldRefresh) {
    pullDistance.value = 0;
    return;
  }

  void refreshFromPullGesture();
}

function handlePullPointerCancel(event) {
  if (activePull && event.pointerId === activePull.pointerId) {
    cancelPullRefresh();
  }
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
    isCompactLayout.value &&
    refreshRuntime &&
    typeof refreshRuntime.refresh === "function" &&
    !pullRefreshing.value &&
    isPrimaryTouchPointer(event) &&
    isAtPageTop() &&
    !isPullRefreshIgnoredTarget(event.target)
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
      class="shell-layout__nav-toggle"
      aria-label="Toggle navigation menu"
      @click="toggleDrawer"
    />

    <slot name="top-left" :surface="resolvedSurface">
      <div class="shell-layout__top-left d-flex align-center ga-2">
        <v-chip class="shell-layout__surface-chip" color="primary" size="small" label>
          {{ resolvedSurfaceLabel }}
        </v-chip>
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
    v-model="drawerOpen"
    border
    class="bg-surface"
    data-testid="jskit-shell-drawer"
    :temporary="isCompactLayout"
    :permanent="!isCompactLayout"
    :width="248"
  >
    <slot name="menu" :surface="resolvedSurface">
      <v-list nav density="comfortable" class="pt-2">
        <v-list-subheader class="text-uppercase text-caption">{{ resolvedSurfaceLabel }}</v-list-subheader>
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

.shell-layout__top-right {
  max-width: min(45vw, 18rem);
  overflow: hidden;
}

.shell-layout__surface-chip {
  max-width: 12rem;
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
  .shell-layout__surface-chip {
    max-width: 8rem;
  }

  .shell-layout__top-right {
    max-width: 40vw;
  }
}
</style>
