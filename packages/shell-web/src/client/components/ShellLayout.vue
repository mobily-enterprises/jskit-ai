<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, useSlots } from "vue";
import { useDisplay } from "vuetify";
import { useShellAppBar } from "../composables/useShellAppBar.js";
import { useShellDrawer } from "../composables/useShellDrawer.js";
import { useShellOutletPlacements } from "../composables/useShellOutletPlacements.js";
import { useShellLayoutState } from "../composables/useShellLayoutState.js";
import { useShellPullToRefresh } from "../composables/useShellPullToRefresh.js";
import {
  DEFAULT_SHELL_NAVIGATION_ITEM_SPACING,
  DEFAULT_SHELL_RAIL_WIDTH
} from "../support/drawerWidth.js";
import {
  normalizeDesktopDrawerClosedMode,
  shellLayoutHasDrawer,
  shellLayoutHasNavigationBar
} from "../support/drawerPresentation.js";
import { resolveShellLayoutClass } from "../support/shellLayoutClass.js";
import { resolveWindowSizeClass } from "../support/windowSizeClass.js";
import { NO_SHELL_WEB_REFRESH_RUNTIME, SHELL_WEB_REFRESH_RUNTIME_KEY } from "../runtime/refreshRuntime.js";
import { useShellNavigation } from "../navigation/useShellNavigation.js";
import ShellNavigationScope from "./ShellNavigationScope.vue";
import ShellOutlet from "./ShellOutlet.vue";
import ShellPageActionsTarget from "./ShellPageActionsTarget.vue";
import ShellPageTitle from "./ShellPageTitle.vue";
import ShellRouteTransition from "./ShellRouteTransition.vue";
import ShellUpButton from "./ShellUpButton.vue";
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
  // The app bar title of pages that declare none (meta.jskit.title) and set none (useShellPageTitle).
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
  // Material 3's 360dp when unset; a number fixes the width, "content" fits the drawer to its labels.
  drawerWidth: {
    type: [Number, String],
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
const { canGoUp } = useShellNavigation();
const navigationToggle = ref(null);
const scrolled = ref(false);

const viewportWidth = computed(() => display.width.value);
const sizeClass = computed(() => resolveWindowSizeClass(display.width.value));
const layoutClass = computed(() => resolveShellLayoutClass(display.width.value));
const isCompactLayout = computed(() => layoutClass.value === "compact");
// Compact and medium windows open the drawer over the page; a medium window keeps a navigation rail beside it.
const modalLayout = computed(() => layoutClass.value !== "expanded");
// A surface draws only the navigation it has: no navigation bar without two bar destinations, and no rail or drawer
// (nor its menu control) without two menu destinations, as on an account surface whose shell has no navigation or a
// surface with Home alone. The surface identity (a workspace switcher) keeps the drawer beside other navigation, as on
// a phone.
const slots = useSlots();
const primaryMenu = useShellOutletPlacements("shell-layout:primary-menu");
const secondaryMenu = useShellOutletPlacements("shell-layout:secondary-menu");
const identity = useShellOutletPlacements("shell-layout:top-left");
const bottomNavigation = useShellOutletPlacements("shell-layout:primary-bottom-nav");
const hasDrawer = computed(() =>
  shellLayoutHasDrawer({
    menuSlot: Boolean(slots.menu),
    menuCount: primaryMenu.value.length + secondaryMenu.value.length,
    identityCount: slots["top-left"] ? 1 : identity.value.length,
    bottomNavigationCount: bottomNavigation.value.length
  })
);
const showsBottomNavigation = computed(() =>
  isCompactLayout.value && shellLayoutHasNavigationBar({
    bottomNavigationCount: bottomNavigation.value.length,
    menuCount: primaryMenu.value.length + secondaryMenu.value.length
  })
);
const showsMediumRail = computed(() =>
  hasDrawer.value &&
  layoutClass.value === "medium" &&
  normalizeDesktopDrawerClosedMode(props.desktopDrawerClosedMode) === "rail"
);
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
} = useShellDrawer({ props, modalLayout, viewportWidth, navigationToggle, layoutState });

const standardDrawerVisible = computed(() => hasDrawer.value && !modalLayout.value && drawerPresentation.value.visible);
// The menu control sits in the rail or drawer header when one shows, otherwise first in the app bar of a top-level
// page; an inner page's leading slot is its Up arrow.
const toggleInAppBar = computed(() => hasDrawer.value && !showsMediumRail.value && !standardDrawerVisible.value);
const fallbackTitle = computed(() => text(props.title) || resolvedSurfaceLabel.value);
const navigationStyle = computed(() => ({
  "--shell-navigation-item-spacing": `${resolvedNavigationItemSpacing.value}px`,
  "--shell-navigation-rail-width": `${resolvedRailWidth.value}px`
}));

// A compact bar keeps one trailing item so the title keeps its room: the page's primary action when it has one (a
// form's Save), otherwise the top-right item nearest the corner (the account menu). The other top-right items follow
// the page actions in the overflow menu. A layout's own top-right slot stays as it is.
const { pageActions } = useShellAppBar();
const topRight = useShellOutletPlacements("shell-layout:top-right");
const topRightInMenu = computed(() => {
  if (!isCompactLayout.value || slots["top-right"]) {
    return 0;
  }
  return Math.max(topRight.value.length - (pageActions.hasPrimary.value ? 0 : 1), 0);
});

function updateScrolled() {
  scrolled.value = window.scrollY > 0;
}

onMounted(() => {
  window.addEventListener("scroll", updateScrolled, { passive: true });
  updateScrolled();
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", updateScrolled);
});
</script>

<template>
  <v-app-bar
    :color="scrolled ? 'surface-container' : 'surface'"
    flat
    :height="64"
    class="shell-layout__app-bar"
    :class="`shell-layout--size-${sizeClass}`"
    data-testid="jskit-shell-app-bar"
    :data-size-class="sizeClass"
  >
    <div class="shell-layout__app-bar-row">
      <ShellUpButton v-if="canGoUp" class="shell-layout__leading" />
      <v-btn
        v-else-if="toggleInAppBar"
        ref="navigationToggle"
        class="shell-layout__leading"
        icon="$menu"
        variant="text"
        color="on-surface"
        data-testid="jskit-shell-nav-toggle"
        :aria-label="drawerToggleLabel"
        :aria-expanded="drawerOpen"
        aria-controls="jskit-shell-drawer"
        @click="toggleDrawer"
      />

      <div class="shell-layout__headline" :class="{ 'shell-layout__headline--leading': canGoUp || toggleInAppBar }">
        <ShellPageTitle :title="fallbackTitle" />
        <p v-if="props.subtitle" class="shell-layout__page-subtitle">{{ text(props.subtitle) }}</p>
      </div>

      <ShellPageActionsTarget>
        <template v-if="topRightInMenu > 0" #menu>
          <ShellOutlet target="shell-layout:top-right" :end="topRightInMenu" />
        </template>
      </ShellPageActionsTarget>

      <slot name="top-right" :surface="resolvedSurface">
        <div class="shell-layout__top-right">
          <ShellOutlet target="shell-layout:top-right" :start="topRightInMenu" />
        </div>
      </slot>
    </div>
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
    v-if="showsMediumRail"
    class="shell-layout__rail"
    data-testid="jskit-shell-rail"
    data-presentation="rail"
    :style="navigationStyle"
    permanent
    rail
    :rail-width="resolvedRailWidth"
    color="surface"
  >
    <div class="shell-layout__rail-header">
      <v-btn
        ref="navigationToggle"
        icon="$menu"
        variant="text"
        color="on-surface-variant"
        data-testid="jskit-shell-nav-toggle"
        :aria-label="drawerToggleLabel"
        :aria-expanded="drawerOpen"
        aria-controls="jskit-shell-drawer"
        @click="toggleDrawer"
      />
    </div>
    <ShellNavigationScope presentation="rail">
      <v-list nav class="shell-layout__rail-list">
        <ShellOutlet target="shell-layout:primary-menu" default />
        <ShellOutlet target="shell-layout:secondary-menu" />
      </v-list>
    </ShellNavigationScope>
  </v-navigation-drawer>

  <!-- A modal drawer is the outermost layout item, so it opens from the window's edge over the rail and app bar. -->
  <v-navigation-drawer
    v-if="hasDrawer"
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
    :style="navigationStyle"
    :color="modalLayout ? 'surface-container-low' : 'surface'"
    :temporary="modalLayout"
    :permanent="!modalLayout"
    :order="modalLayout ? -1 : 0"
    :width="resolvedDrawerWidth"
    :rail="drawerPresentation.rail"
    :rail-width="resolvedRailWidth"
    @update:model-value="handleDrawerVisibilityChange"
  >
    <!-- The menu control alone, its tooltip its label: no text beside it that would read as its label. -->
    <div v-if="standardDrawerVisible" class="shell-layout__drawer-header">
      <v-btn
        ref="navigationToggle"
        icon
        variant="text"
        color="on-surface-variant"
        data-testid="jskit-shell-nav-toggle"
        :aria-label="drawerToggleLabel"
        :aria-expanded="drawerOpen"
        aria-controls="jskit-shell-drawer"
        @click="toggleDrawer"
      >
        <v-icon :icon="drawerPresentation.rail ? '$menu' : '$menuOpen'" />
        <v-tooltip activator="parent" location="end" :text="drawerToggleLabel" />
      </v-btn>
    </div>
    <div v-if="!drawerPresentation.rail" class="shell-layout__identity">
      <slot name="top-left" :surface="resolvedSurface">
        <ShellOutlet target="shell-layout:top-left" />
      </slot>
    </div>
    <slot name="menu" :surface="resolvedSurface" :rail="drawerPresentation.rail">
      <ShellNavigationScope :presentation="drawerPresentation.rail ? 'rail' : 'drawer'">
        <v-list
          nav
          class="shell-layout__drawer-list"
          :prepend-gap="resolvedNavigationItemSpacing"
        >
          <ShellOutlet
            target="shell-layout:primary-menu"
            default
          />
          <v-divider class="shell-layout__drawer-divider" />
          <ShellOutlet target="shell-layout:secondary-menu" />
        </v-list>
      </ShellNavigationScope>
    </slot>
  </v-navigation-drawer>

  <v-main class="bg-background">
    <div class="shell-layout__content" :class="{ 'shell-layout__content--compact': isCompactLayout }">
      <ShellRouteTransition>
        <slot />
      </ShellRouteTransition>
    </div>
  </v-main>

  <v-bottom-navigation
    v-if="showsBottomNavigation"
    class="shell-layout__bottom-nav"
    data-testid="jskit-shell-bottom-nav"
    bg-color="surface-container"
    :elevation="0"
    :height="80"
    grow
  >
    <ShellNavigationScope presentation="bar">
      <ShellOutlet target="shell-layout:primary-bottom-nav" />
    </ShellNavigationScope>
  </v-bottom-navigation>

  <v-bottom-sheet
    v-if="isCompactLayout"
    :model-value="supportingContentOpen"
    @update:model-value="setSupportingContentOpen"
  >
    <v-card class="shell-layout__supporting-sheet" data-testid="jskit-shell-supporting-bottom-sheet">
      <div class="shell-layout__supporting-title">
        <h2 class="shell-layout__supporting-headline">{{ text(supportingContentTitle) || t("jskit.shell.layout.details") }}</h2>
        <v-btn icon="$close" variant="text" color="on-surface-variant" :aria-label="t('jskit.shell.actions.close')" @click="closeSupportingContent" />
      </div>
      <div class="shell-layout__supporting-body">
        <ShellOutlet target="shell-layout:supporting-bottom-sheet" />
      </div>
    </v-card>
  </v-bottom-sheet>

  <v-navigation-drawer
    v-if="!isCompactLayout"
    :model-value="supportingContentOpen"
    class="shell-layout__supporting-side-sheet"
    color="surface-container-low"
    temporary
    location="right"
    :width="384"
    data-testid="jskit-shell-supporting-side-panel"
    @update:model-value="setSupportingContentOpen"
  >
    <div class="shell-layout__supporting-side-panel">
      <div class="shell-layout__supporting-title">
        <h2 class="shell-layout__supporting-headline">{{ text(supportingContentTitle) || t("jskit.shell.layout.details") }}</h2>
        <v-btn icon="$close" variant="text" color="on-surface-variant" :aria-label="t('jskit.shell.actions.close')" @click="closeSupportingContent" />
      </div>
      <ShellOutlet target="shell-layout:supporting-side-panel" />
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
/* Material 3 small top app bar: 64dp, surface at rest and surface-container once the page scrolls under it. */
.shell-layout__app-bar {
  transition: background-color 200ms cubic-bezier(0.2, 0, 0, 1);
}

.shell-layout__app-bar :deep(.v-toolbar__content) {
  padding: 0;
}

.shell-layout__app-bar-row {
  align-items: center;
  display: flex;
  height: 100%;
  inline-size: 100%;
  min-width: 0;
  padding-inline: 4px;
}

.shell-layout__leading {
  flex: 0 0 auto;
}

.shell-layout__headline {
  flex: 1 1 auto;
  min-width: 0;
  padding-inline: 12px 4px;
}

.shell-layout__headline--leading {
  padding-inline-start: 4px;
}

.shell-layout__page-subtitle {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.03125rem;
  line-height: 1rem;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell-layout__top-right {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
}

/* Navigation rail (medium windows, and expanded ones with the drawer collapsed): 80dp, menu control on top. */
.shell-layout__rail,
.shell-layout__drawer {
  border: 0;
}

.shell-layout__rail-header,
.shell-layout__drawer-header {
  align-items: center;
  display: flex;
  gap: 4px;
  min-height: 56px;
  padding-block: 4px;
}

.shell-layout__rail-header,
.shell-layout__drawer[data-presentation="rail"] .shell-layout__drawer-header {
  justify-content: center;
}

.shell-layout__drawer:not([data-presentation="rail"]) .shell-layout__drawer-header {
  padding-inline: 24px 12px;
}

.shell-layout__drawer[data-presentation="drawer"] .shell-layout__drawer-header {
  padding-inline-start: max(0px, calc(var(--shell-navigation-rail-width) / 2 - 24px));
}

.shell-layout__identity {
  min-width: 0;
  padding-inline: 12px;
}

.shell-layout__identity:empty {
  display: none;
}

.shell-layout__rail-list,
.shell-layout__drawer[data-presentation="rail"] .shell-layout__drawer-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
}

.shell-layout__rail-list :deep(.v-list-item),
.shell-layout__drawer[data-presentation="rail"] :deep(.v-list-item) {
  inline-size: 100%;
  justify-content: center;
  margin: 0;
  min-height: 56px;
  min-width: 48px;
}

.shell-layout__drawer[data-presentation="rail"] .shell-layout__drawer-divider {
  display: none;
}

/* Navigation drawer: items 56dp pills inset 12dp, icons lined up with the rail's. */
.shell-layout__drawer {
  --shell-navigation-drawer-inset: 12px;
  --shell-navigation-icon-size: 24px;
}

.shell-layout__drawer:not([data-presentation="rail"]) .shell-layout__drawer-list {
  padding-block: 0 12px;
  padding-inline-end: calc(var(--shell-navigation-item-spacing) / 2);
  padding-inline-start: var(--shell-navigation-drawer-inset);
}

.shell-layout__drawer:not([data-presentation="rail"]) :deep(.v-list-item) {
  margin-bottom: 0;
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

.shell-layout__drawer :deep(.v-list-item-title) {
  white-space: nowrap;
}

.shell-layout__drawer-divider {
  margin-block: 8px;
  margin-inline: 16px;
}

/* The divider separates the secondary destinations from the primary ones, so it goes when either group is empty
   (a compact window's drawer has no primary destinations: they are in the navigation bar). */
.shell-layout__drawer-divider:first-child,
.shell-layout__drawer-divider:last-child {
  display: none;
}

/* Modal drawer: Material 3 rounds its trailing corners 16dp. */
.shell-layout__drawer[data-presentation="modal"] {
  border-end-end-radius: 16px;
  border-start-end-radius: 16px;
}

/* Material 3 window margins: 16dp on compact windows, 24dp wider. */
.shell-layout__content {
  padding: 8px 24px calc(24px + env(safe-area-inset-bottom, 0px));
}

.shell-layout__content--compact {
  padding-inline: 16px;
}

/* Navigation bar (compact windows): 80dp on surface-container. */
.shell-layout__bottom-nav {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.shell-layout__bottom-nav :deep(.v-bottom-navigation__content) {
  gap: 8px;
  padding-inline: 8px;
}

.shell-layout__supporting-sheet {
  max-height: min(72vh, 40rem);
  overflow: auto;
}

.shell-layout__supporting-side-sheet {
  border: 0;
  border-end-start-radius: 16px;
  border-start-start-radius: 16px;
}

.shell-layout__supporting-side-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 12px 24px 24px;
}

.shell-layout__supporting-title {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 56px;
}

.shell-layout__supporting-sheet .shell-layout__supporting-title {
  padding: 12px 12px 0 24px;
}

.shell-layout__supporting-body {
  padding: 0 24px 24px;
}

.shell-layout__supporting-headline {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 1.375rem;
  font-weight: 400;
  line-height: 1.75rem;
  margin: 0;
}

.shell-layout__pull-refresh {
  align-items: center;
  background: rgb(var(--v-theme-surface-container-low));
  border-radius: 9999px;
  box-shadow:
    0 1px 2px 0 rgba(var(--v-theme-shadow), 0.3),
    0 2px 6px 2px rgba(var(--v-theme-shadow), 0.15);
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  gap: 8px;
  left: 50%;
  opacity: min(1, calc(var(--shell-pull-refresh-distance) / 56));
  padding: 8px 12px;
  pointer-events: none;
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 72px);
  transform: translate3d(-50%, calc((var(--shell-pull-refresh-distance) - 72px) * 0.35), 0);
  transition:
    opacity 200ms cubic-bezier(0.2, 0, 0, 1),
    transform 200ms cubic-bezier(0.2, 0, 0, 1);
  z-index: 2700;
}

.shell-layout__pull-refresh--refreshing {
  opacity: 1;
}

.shell-layout__pull-refresh-label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.03125rem;
  line-height: 1rem;
  white-space: nowrap;
}
</style>
