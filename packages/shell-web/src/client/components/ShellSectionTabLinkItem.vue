<script setup>
import { computed } from "vue";
import { useLink } from "vue-router";
import {
  shellNavigationLinkProps,
  useShellNavigationLink
} from "../composables/useShellNavigationLink.js";
import { useJskitText } from "../i18n.js";

// A Material 3 primary tab that links to a section of a page (page.section-nav): its label in title-small, with the
// placement's icon above it when it names one, and under the active one's content a 3dp primary indicator with
// rounded top corners. The tabs sit in the page's own row, which draws the 1dp outline-variant divider under them
// and scrolls sideways when they don't fit; this is not the navigation bar's destination (ShellTabLinkItem).
const props = defineProps(shellNavigationLinkProps);
const { t } = useJskitText();
const { resolvedLabel, resolvedTarget, resolvedIcon } = useShellNavigationLink(props);
const link = useLink({ to: computed(() => (resolvedTarget.value.sameOrigin && resolvedTarget.value.href) || "/") });
const active = computed(() =>
  resolvedTarget.value.sameOrigin && Boolean(props.exact ? link.isExactActive.value : link.isActive.value)
);
// Only an icon the placement names: a section tab guesses none from its label.
const icon = computed(() => (props.icon ? resolvedIcon.value : ""));
</script>

<template>
  <v-btn
    v-if="resolvedTarget.href"
    class="section-tab-link-item text-none"
    :class="{ 'section-tab-link-item--active': active, 'section-tab-link-item--icon': Boolean(icon) }"
    :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
    :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
    :active="active"
    :aria-current="active ? 'page' : undefined"
    :disabled="props.disabled"
    :exact="props.exact"
    variant="text"
    rounded="0"
    min-width="0"
  >
    <v-icon v-if="icon" :icon="icon" class="section-tab-link-item__icon" />
    <span class="section-tab-link-item__label">{{ resolvedLabel || t("jskit.shell.layout.tab") }}</span>
    <span class="section-tab-link-item__indicator" aria-hidden="true" />
  </v-btn>
</template>

<style scoped>
.section-tab-link-item {
  color: rgb(var(--v-theme-on-surface-variant));
  flex: 0 0 auto;
  height: 48px;
  padding-inline: 16px;
}

.section-tab-link-item--icon {
  height: 64px;
}

.section-tab-link-item--active {
  color: rgb(var(--v-theme-primary));
}

.section-tab-link-item :deep(.v-btn__content) {
  align-self: stretch;
  flex-direction: column;
  gap: 2px;
  justify-content: center;
  position: relative;
}

/* The indicator marks the selection; the state layer stays for hover, focus and press. */
.section-tab-link-item.v-btn--active > :deep(.v-btn__overlay) {
  opacity: 0;
}

.section-tab-link-item.v-btn--active:hover > :deep(.v-btn__overlay) {
  opacity: var(--v-hover-opacity);
}

.section-tab-link-item.v-btn--active:focus-visible > :deep(.v-btn__overlay) {
  opacity: var(--v-focus-opacity);
}

.section-tab-link-item__label {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.00625rem;
  line-height: 1.25rem;
  white-space: nowrap;
}

.section-tab-link-item__indicator {
  background: rgb(var(--v-theme-primary));
  border-radius: 3px 3px 0 0;
  bottom: 0;
  height: 3px;
  inset-inline: 0;
  opacity: 0;
  position: absolute;
}

.section-tab-link-item--active .section-tab-link-item__indicator {
  opacity: 1;
}
</style>
