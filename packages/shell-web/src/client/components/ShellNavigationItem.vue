<script setup>
import { computed, inject } from "vue";
import { useLink } from "vue-router";
import {
  NO_SHELL_NAVIGATION_PRESENTATION,
  NO_VUETIFY_ICONS,
  SHELL_NAVIGATION_PRESENTATION_KEY,
  VUETIFY_ICONS_KEY,
  filledIconAlias
} from "../support/navigationPresentation.js";
import { activateShellNavigationLinkOnSpace } from "../support/navigationLinkKeyboard.js";

// One navigation destination as Material 3 draws it where it sits: a drawer item (a 56dp pill), a rail item (icon in a
// 56x32 indicator with its label below) or a list item. The active destination's icon is filled.
const props = defineProps({
  label: {
    type: String,
    default: ""
  },
  href: {
    type: String,
    default: ""
  },
  sameOrigin: {
    type: Boolean,
    default: true
  },
  icon: {
    type: String,
    default: ""
  },
  disabled: {
    type: Boolean,
    default: false
  },
  exact: {
    type: Boolean,
    default: false
  }
});

/** @type {{ value: string }} */
const presentation = inject(SHELL_NAVIGATION_PRESENTATION_KEY, NO_SHELL_NAVIGATION_PRESENTATION);
/** @type {{ aliases?: Record<string, unknown> }} */
const iconOptions = inject(VUETIFY_ICONS_KEY, NO_VUETIFY_ICONS);
const link = useLink({ to: computed(() => (props.sameOrigin && props.href) || "/") });
const active = computed(() =>
  props.sameOrigin && Boolean(props.exact ? link.isExactActive.value : link.isActive.value)
);
const displayIcon = computed(() => (active.value ? filledIconAlias(props.icon, iconOptions.aliases) : props.icon));
const rail = computed(() => presentation.value === "rail");
</script>

<template>
  <v-list-item
    v-if="rail"
    class="shell-menu-link-item shell-menu-link-item--rail"
    :to="props.sameOrigin ? props.href : undefined"
    :href="props.sameOrigin ? undefined : props.href"
    :active="active"
    :disabled="props.disabled"
    :ripple="false"
    @keydown.space="activateShellNavigationLinkOnSpace"
  >
    <span class="shell-menu-link-item__indicator">
      <v-icon v-if="displayIcon" :icon="displayIcon" />
    </span>
    <span class="shell-menu-link-item__rail-label">{{ props.label }}</span>
  </v-list-item>
  <v-list-item
    v-else
    class="shell-menu-link-item"
    :title="props.label"
    :to="props.sameOrigin ? props.href : undefined"
    :href="props.sameOrigin ? undefined : props.href"
    :prepend-icon="displayIcon || undefined"
    :active="active"
    :disabled="props.disabled"
    @keydown.space="activateShellNavigationLinkOnSpace"
  />
</template>

<style scoped>
.shell-menu-link-item {
  --v-activated-opacity: 0;
  border-radius: 9999px;
  color: rgb(var(--v-theme-on-surface-variant));
  min-height: 56px;
}

.shell-menu-link-item :deep(.v-list-item-title) {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.00625rem;
  line-height: 1.25rem;
}

.shell-menu-link-item:not(.shell-menu-link-item--rail).v-list-item--active {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.shell-menu-link-item :deep(.v-list-item__prepend > .v-icon) {
  opacity: 1;
}

.shell-menu-link-item--rail {
  background: transparent;
  border-radius: 0;
  min-height: 56px;
  padding: 0;
}

.shell-menu-link-item--rail > :deep(.v-list-item__overlay) {
  display: none;
}

.shell-menu-link-item--rail :deep(.v-list-item__content) {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: visible;
}

.shell-menu-link-item__indicator {
  align-items: center;
  border-radius: 16px;
  display: flex;
  height: 32px;
  justify-content: center;
  overflow: hidden;
  position: relative;
  width: 56px;
}

.shell-menu-link-item__indicator::before {
  background: currentColor;
  content: "";
  inset: 0;
  opacity: 0;
  position: absolute;
  transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
}

.shell-menu-link-item--rail:hover .shell-menu-link-item__indicator::before {
  opacity: var(--v-hover-opacity);
}

.shell-menu-link-item--rail:focus-visible .shell-menu-link-item__indicator::before,
.shell-menu-link-item--rail:active .shell-menu-link-item__indicator::before {
  opacity: var(--v-focus-opacity);
}

.shell-menu-link-item--rail.v-list-item--active .shell-menu-link-item__indicator {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

/* A rail label is shown in full: one wider than the rail wraps to a second line, as Material 3's rail labels do,
   and only a label that needs a third line ends the second in an ellipsis. */
.shell-menu-link-item__rail-label {
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  display: -webkit-box;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.03125rem;
  line-height: 1rem;
  max-width: calc(var(--shell-navigation-rail-width, 80px) - 8px);
  overflow: hidden;
  overflow-wrap: break-word;
  text-align: center;
  white-space: normal;
}

.shell-menu-link-item--rail.v-list-item--active .shell-menu-link-item__rail-label {
  color: rgb(var(--v-theme-on-surface));
}
</style>
