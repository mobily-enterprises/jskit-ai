<script setup>
import { computed, inject, mergeProps, ref, useSlots, watch } from "vue";
import { useJskitText } from "../i18n.js";
import { SHELL_PAGE_ACTIONS_ID } from "../support/navigationPresentation.js";
import { NO_SHELL_PAGE_ACTIONS_REGISTRY, SHELL_PAGE_ACTIONS_REGISTRY_KEY } from "../support/pageActions.js";

// Where the current page's ShellPageActions show: after the page title in the top app bar, followed by the bar's
// overflow menu (Material 3's trailing "More actions" menu) when an action goes there. Its `menu` slot adds the
// bar's own items that don't fit (on a phone, ShellLayout's top-right items) below the actions. The menu keeps the slot
// mounted while it is closed, so an item there that does more than draw a button keeps working. ShellLayout's bar has
// it; a layout that draws its own top app bar renders it once there and calls useShellAppBar().
const props = defineProps({
  // Whether the `menu` slot holds items now. A layout that moves its items in and out of the slot keeps it and says
  // when it holds any: with none, the menu shows only the page's actions, or no menu button without them.
  menuItems: {
    type: Boolean,
    default: true
  }
});

const { t } = useJskitText();
/** @type {import("../support/pageActions.js").ShellPageActionsRegistry} */
const registry = inject(SHELL_PAGE_ACTIONS_REGISTRY_KEY, NO_SHELL_PAGE_ACTIONS_REGISTRY);
const menuEntries = registry.menuEntries;
const moreLabel = computed(() => t("jskit.shell.actions.more"));
const slots = useSlots();
const menuOpen = ref(false);

// Read as the menu renders, since slots are not reactive.
function showsItems() {
  return props.menuItems && Boolean(slots.menu);
}

function showsMenu() {
  return menuEntries.value.length > 0 || showsItems();
}

// Nothing left to show, such as the last item moving back to a bar that has grown: the menu closes.
watch(showsMenu, (shows) => {
  if (!shows) {
    menuOpen.value = false;
  }
});

// A menu item's props: the action's own attributes, then its label, icon, colour, link or download, and state.
function itemProps(entry) {
  const state = entry.state.value;
  const unavailable = Boolean(state.disabled || state.loading);
  return mergeProps(entry.attrs, {
    title: state.label,
    prependIcon: state.icon || undefined,
    baseColor: state.color,
    to: state.to,
    replace: state.replace,
    href: state.href,
    download: state.download,
    disabled: unavailable,
    "aria-disabled": unavailable ? "true" : undefined
  });
}
</script>

<template>
  <div :id="SHELL_PAGE_ACTIONS_ID" class="shell-page-actions-target" />
  <v-menu v-if="menuEntries.length > 0 || slots.menu" v-model="menuOpen" location="bottom end" :eager="Boolean(slots.menu)">
    <template #activator="{ props: menuProps }">
      <v-tooltip v-if="showsMenu()" :text="moreLabel" location="bottom">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            v-bind="mergeProps(menuProps, tooltipProps)"
            class="shell-page-actions-overflow"
            icon="$moreVert"
            variant="text"
            color="on-surface-variant"
            :aria-label="moreLabel"
            data-testid="jskit-shell-page-actions-overflow"
          />
        </template>
      </v-tooltip>
    </template>
    <v-list v-if="!slots.menu" role="menu" min-width="160">
      <v-list-item
        v-for="entry in menuEntries"
        :key="entry.id"
        v-bind="itemProps(entry)"
        role="menuitem"
        @click="entry.activate"
      />
    </v-list>
    <!-- With the bar's own items too, the menu is a panel: the actions' list, then those items. -->
    <v-sheet v-else class="shell-page-actions-target__panel" color="surface-container" elevation="2" rounded="4">
      <v-list v-if="menuEntries.length > 0" role="menu" min-width="160">
        <v-list-item
          v-for="entry in menuEntries"
          :key="entry.id"
          v-bind="itemProps(entry)"
          role="menuitem"
          @click="entry.activate"
        />
      </v-list>
      <div v-show="showsItems()" class="shell-page-actions-target__items" data-testid="jskit-shell-page-actions-overflow-items">
        <slot name="menu" />
      </div>
    </v-sheet>
  </v-menu>
</template>

<style scoped>
.shell-page-actions-target {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
}

.shell-page-actions-target:empty {
  display: none;
}

.shell-page-actions-target__items {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  padding: 4px 8px;
}
</style>
