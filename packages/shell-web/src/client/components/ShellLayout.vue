<script setup>
import { computed, inject, ref } from "vue";
import { useDisplay } from "vuetify";
import { useShellDrawer } from "../composables/useShellDrawer.js";
import { useShellLayoutState } from "../composables/useShellLayoutState.js";
import { useShellPullToRefresh } from "../composables/useShellPullToRefresh.js";
import {
  DEFAULT_SHELL_NAVIGATION_ITEM_SPACING,
  DEFAULT_SHELL_RAIL_WIDTH
} from "../support/drawerWidth.js";
import { resolveShellLayoutClass } from "../support/shellLayoutClass.js";
import { NO_SHELL_WEB_REFRESH_RUNTIME, SHELL_WEB_REFRESH_RUNTIME_KEY } from "../runtime/refreshRuntime.js";
import ShellOutlet from "./ShellOutlet.vue";
import ShellRouteTransition from "./ShellRouteTransition.vue";
import { useJskitText } from "../i18n.js";

const { t, text } = useJskitText();

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

const layoutState = useShellLayoutState(props);
const {
  drawerOpen,
  supportingContentOpen,
  supportingContentTitle,
  setSupportingContentOpen,
  closeSupportingContent,
  toggleDrawer,
  resolvedSurface,
  resolvedSurfaceLabel
} = layoutState;
const display = useDisplay();
/** @type {import("../types.js").ShellRefreshRuntime} */
const refreshRuntime = inject(SHELL_WEB_REFRESH_RUNTIME_KEY, NO_SHELL_WEB_REFRESH_RUNTIME);
const navigationToggle = ref(null);

const layoutClass = computed(() => resolveShellLayoutClass(display.name.value));
const isCompactLayout = computed(() => layoutClass.value === "compact");
const {
  pullRefreshing,
  pullProgress,
  pullIndicatorVisible,
  pullRefreshLabel,
  pullRefreshStyle
} = useShellPullToRefresh({ enabled: isCompactLayout, refreshRuntime });
const {
  drawerPresentation,
  drawerToggleLabel,
  fixedDrawerWidth,
  handleDrawerVisibilityChange,
  resolvedDrawerWidth,
  resolvedNavigationItemSpacing,
  resolvedRailWidth
} = useShellDrawer({ props, isCompactLayout, navigationToggle, layoutState });
</script>

<template>
  <v-app-bar
    :density="isCompactLayout ? 'compact' : 'comfortable'"
    elevation="0"
    class="shell-layout__app-bar"
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
    id="jskit-shell-drawer"
    :model-value="drawerPresentation.visible"
    class="shell-layout__drawer"
    data-testid="jskit-shell-drawer"
    :data-layout="layoutClass"
    :data-presentation="drawerPresentation.kind"
    :data-drawer-width-mode="fixedDrawerWidth ? 'fixed' : 'content'"
    :data-drawer-width="resolvedDrawerWidth"
    :data-navigation-item-spacing="resolvedNavigationItemSpacing"
    :data-rail-width="resolvedRailWidth"
    :style="{
      '--shell-navigation-item-spacing': `${resolvedNavigationItemSpacing}px`,
      '--shell-navigation-rail-width': `${resolvedRailWidth}px`
    }"
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
      <h1 v-if="title" class="shell-layout__title text-h5">{{ text(title) }}</h1>
      <p v-if="subtitle" class="shell-layout__subtitle text-body-2 text-medium-emphasis">{{ text(subtitle) }}</p>
      <ShellRouteTransition>
        <slot />
      </ShellRouteTransition>
    </v-container>
  </v-main>

  <v-bottom-navigation
    v-if="isCompactLayout"
    class="shell-layout__bottom-nav"
    data-testid="jskit-shell-bottom-nav"
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
        <span>{{ text(supportingContentTitle) || t("jskit.shell.layout.details") }}</span>
        <v-btn variant="text" @click="closeSupportingContent">{{ t("jskit.shell.actions.close") }}</v-btn>
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
        <strong>{{ text(supportingContentTitle) || t("jskit.shell.layout.details") }}</strong>
        <v-btn variant="text" @click="closeSupportingContent">{{ t("jskit.shell.actions.close") }}</v-btn>
      </div>
      <ShellOutlet target="shell-layout:supporting-side-panel" />
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
/*
 * Shell chrome follows the app's Vuetify theme and is restyled through these
 * custom properties (set them on :root or any ancestor):
 *   --shell-chrome-border-width / --shell-chrome-border-color   shared dividers
 *   --shell-app-bar-border-width, --shell-navigation-border-width,
 *   --shell-bottom-navigation-border-width                       per-edge overrides
 *   --shell-app-bar-background, --shell-navigation-background,
 *   --shell-bottom-navigation-background                         surfaces
 * A Material 3 restyle sets the border widths to 0 and separates surfaces
 * tonally, e.g. --shell-navigation-background: rgb(var(--v-theme-surface-container-low)).
 */
.shell-layout__app-bar {
  border-style: solid;
  border-color: var(--shell-chrome-border-color, rgba(var(--v-border-color), var(--v-border-opacity)));
  border-width: 0 0 var(--shell-app-bar-border-width, var(--shell-chrome-border-width, thin));
  background: var(--shell-app-bar-background, rgb(var(--v-theme-surface)));
  color: rgb(var(--v-theme-on-surface));
}

.shell-layout__drawer {
  border-style: solid;
  border-color: var(--shell-chrome-border-color, rgba(var(--v-border-color), var(--v-border-opacity)));
  border-width: 0;
  border-inline-end-width: var(--shell-navigation-border-width, var(--shell-chrome-border-width, thin));
  background: var(--shell-navigation-background, rgb(var(--v-theme-surface)));
}

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

.shell-layout__drawer {
  --shell-navigation-drawer-inset: 12px;
  --shell-navigation-icon-size: 24px;
}

.shell-layout__drawer[data-presentation="drawer"] :deep(.v-list--nav) {
  padding-inline-end: calc(var(--shell-navigation-item-spacing) / 2);
  padding-inline-start: var(--shell-navigation-drawer-inset);
}

.shell-layout__drawer[data-presentation="drawer"] :deep(.v-list-item) {
  padding-inline-end: calc(var(--shell-navigation-item-spacing) / 2);
  padding-inline-start: max(
    0px,
    calc(
      var(--shell-navigation-rail-width) / 2 -
      var(--shell-navigation-icon-size) / 2 -
      var(--shell-navigation-drawer-inset)
    )
  );
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
  border-top: var(--shell-bottom-navigation-border-width, var(--shell-chrome-border-width, thin)) solid
    var(--shell-chrome-border-color, rgba(var(--v-border-color), var(--v-border-opacity)));
  background: var(--shell-bottom-navigation-background, rgb(var(--v-theme-surface)));
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.shell-layout__bottom-nav :deep(.v-btn) {
  min-height: 48px;
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
