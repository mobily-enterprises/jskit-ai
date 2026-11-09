<script setup>
import { computed, inject } from "vue";
import { useLink } from "vue-router";
import {
  shellNavigationLinkProps,
  useShellNavigationLink
} from "../composables/useShellNavigationLink.js";
import {
  NO_SHELL_NAVIGATION_PRESENTATION,
  NO_VUETIFY_ICONS,
  SHELL_NAVIGATION_PRESENTATION_KEY,
  VUETIFY_ICONS_KEY,
  filledIconAlias
} from "../support/navigationPresentation.js";
import { useJskitText } from "../i18n.js";
import ShellSectionTabLinkItem from "./ShellSectionTabLinkItem.vue";

// A Material 3 navigation bar destination: its icon and its label below, which @jskit-ai/material-web's material.css
// draws as it draws every v-bottom-navigation's buttons (the icon in its 64x32 indicator); the active one's icon is
// the filled one. It is one only in ShellLayout's navigation bar; placed anywhere else (a page's section tabs), it is
// a section tab, ShellSectionTabLinkItem, which a page.section-nav names itself. In the bar it is a text button, so
// no app's filled-button defaults fill it.
const props = defineProps(shellNavigationLinkProps);
/** @type {{ value: string }} */
const presentation = inject(SHELL_NAVIGATION_PRESENTATION_KEY, NO_SHELL_NAVIGATION_PRESENTATION);
const inNavigationBar = computed(() => presentation.value === "bar");
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
  <ShellSectionTabLinkItem v-if="!inNavigationBar" v-bind="props" />
  <v-btn
    v-else-if="resolvedTarget.href"
    class="tab-link-item text-none"
    :class="{ 'tab-link-item--active': active }"
    :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
    :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
    :active="active"
    :disabled="props.disabled"
    :exact="props.exact"
    :ripple="false"
    variant="text"
    min-width="0"
    stacked
  >
    <v-icon v-if="displayIcon" :icon="displayIcon" />
    <span class="tab-link-item__label">{{ resolvedLabel || t("jskit.shell.layout.tab") }}</span>
  </v-btn>
</template>

<style scoped>
.tab-link-item {
  flex: 1 1 0;
  height: 100%;
  min-height: 48px;
  padding-inline: 0;
}

.tab-link-item__label {
  max-width: 5.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
