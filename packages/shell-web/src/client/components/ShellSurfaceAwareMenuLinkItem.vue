<script setup>
import {
  shellNavigationLinkProps,
  useShellNavigationLink
} from "../composables/useShellNavigationLink.js";
import ShellNavigationItem from "./ShellNavigationItem.vue";

const props = defineProps(shellNavigationLinkProps);
const { resolvedLabel, resolvedTarget, resolvedIcon } = useShellNavigationLink(props);
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
