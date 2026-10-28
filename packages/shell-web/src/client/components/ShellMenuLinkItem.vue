<script setup>
import { computed } from "vue";
import { useWebPlacementContext } from "../placement/index.js";
import { resolveMenuLinkIcon } from "../lib/menuIcons.js";
import { resolveMenuLinkHref } from "../support/menuLinkTarget.js";
import { activateShellNavigationLinkOnSpace } from "../support/navigationLinkKeyboard.js";
import ShellNavigationTooltip from "./ShellNavigationTooltip.vue";
import { useJskitText } from "../i18n.js";

// The label may be a message key, { key, fallback } or plain text.
const props = defineProps({
  label: {
    type: [String, Object],
    default: ""
  },
  to: {
    type: String,
    default: ""
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

const { context: placementContext } = useWebPlacementContext();
const { text } = useJskitText();
const resolvedLabel = computed(() => text(props.label));

const resolvedTarget = computed(() => resolveMenuLinkHref(placementContext.value, props.to));

const resolvedIcon = computed(() =>
  resolveMenuLinkIcon({
    icon: props.icon,
    // Icons follow the English label, so they do not change with the language.
    label: text(props.label, { locale: "en" }),
    to: resolvedTarget.value.href || props.to
  })
);
</script>

<template>
  <ShellNavigationTooltip v-if="resolvedTarget.href" :label="resolvedLabel">
    <template #default="{ activatorProps }">
      <v-list-item
        v-bind="activatorProps"
        class="shell-menu-link-item"
        :title="resolvedLabel"
        :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
        :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
        :prepend-icon="resolvedIcon || undefined"
        :disabled="props.disabled"
        :exact="props.exact"
        :aria-label="resolvedLabel"
        @keydown.space="activateShellNavigationLinkOnSpace"
      />
    </template>
  </ShellNavigationTooltip>
</template>

<style scoped>
.shell-menu-link-item {
  min-height: 48px;
}
</style>
