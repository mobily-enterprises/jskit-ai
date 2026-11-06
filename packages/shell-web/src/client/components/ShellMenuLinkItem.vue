<script setup>
import { computed } from "vue";
import { useWebPlacementContext } from "../placement/index.js";
import { resolveMenuLinkIcon } from "../lib/menuIcons.js";
import { resolveMenuLinkHref } from "../support/menuLinkTarget.js";
import ShellNavigationItem from "./ShellNavigationItem.vue";
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
  <ShellNavigationItem
    v-if="resolvedTarget.href"
    :label="resolvedLabel"
    :href="resolvedTarget.href"
    :same-origin="resolvedTarget.sameOrigin"
    :icon="resolvedIcon"
    :disabled="props.disabled"
    :exact="props.exact"
  />
</template>
