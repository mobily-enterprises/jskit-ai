<script setup>
import { computed, inject } from "vue";
import { useLink } from "vue-router";
import {
  shellNavigationLinkProps,
  useShellNavigationLink
} from "../composables/useShellNavigationLink.js";
import { NO_VUETIFY_ICONS, VUETIFY_ICONS_KEY, filledIconAlias } from "../support/navigationPresentation.js";
import { useJskitText } from "../i18n.js";

// A Material 3 navigation bar destination: the icon in a 64x32 indicator with its label below; the active one's
// indicator is filled and so is its icon.
const props = defineProps(shellNavigationLinkProps);
const { t } = useJskitText();
const { resolvedLabel, resolvedTarget, resolvedIcon } = useShellNavigationLink(props);
/** @type {{ aliases?: Record<string, unknown> }} */
const iconOptions = inject(VUETIFY_ICONS_KEY, NO_VUETIFY_ICONS);
const link = useLink({ to: computed(() => (resolvedTarget.value.sameOrigin && resolvedTarget.value.href) || "/") });
const active = computed(() =>
  resolvedTarget.value.sameOrigin && Boolean(props.exact ? link.isExactActive.value : link.isActive.value)
);
const displayIcon = computed(() =>
  active.value ? filledIconAlias(resolvedIcon.value, iconOptions.aliases) : resolvedIcon.value
);
</script>

<template>
  <v-btn
    v-if="resolvedTarget.href"
    class="tab-link-item text-none"
    :class="{ 'tab-link-item--active': active }"
    :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
    :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
    :active="active"
    :disabled="props.disabled"
    :exact="props.exact"
    :ripple="false"
    min-width="0"
    stacked
  >
    <span class="tab-link-item__indicator">
      <v-icon v-if="displayIcon" :icon="displayIcon" />
    </span>
    <span class="tab-link-item__label">{{ resolvedLabel || t("jskit.shell.layout.tab") }}</span>
  </v-btn>
</template>

<style scoped>
.tab-link-item {
  color: rgb(var(--v-theme-on-surface-variant));
  flex: 1 1 0;
  height: 100%;
  min-height: 48px;
  padding-inline: 0;
}

.tab-link-item > :deep(.v-btn__overlay),
.tab-link-item > :deep(.v-btn__underlay) {
  display: none;
}

.tab-link-item :deep(.v-btn__content) {
  flex-direction: column;
  gap: 4px;
}

.tab-link-item__indicator {
  align-items: center;
  border-radius: 16px;
  display: flex;
  height: 32px;
  justify-content: center;
  overflow: hidden;
  position: relative;
  width: 64px;
}

.tab-link-item__indicator::before {
  background: currentColor;
  content: "";
  inset: 0;
  opacity: 0;
  position: absolute;
  transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
}

.tab-link-item:hover .tab-link-item__indicator::before {
  opacity: var(--v-hover-opacity);
}

.tab-link-item:focus-visible .tab-link-item__indicator::before,
.tab-link-item:active .tab-link-item__indicator::before {
  opacity: var(--v-focus-opacity);
}

.tab-link-item--active .tab-link-item__indicator {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.tab-link-item__label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.03125rem;
  line-height: 1rem;
  max-width: 5.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-link-item--active .tab-link-item__label {
  color: rgb(var(--v-theme-on-surface));
}
</style>
