<script setup>
import {
  shellNavigationLinkProps,
  useShellNavigationLink
} from "../composables/useShellNavigationLink.js";
import { activateShellNavigationLinkOnSpace } from "../support/navigationLinkKeyboard.js";
import ShellNavigationTooltip from "./ShellNavigationTooltip.vue";

const props = defineProps(shellNavigationLinkProps);
const { resolvedTarget, resolvedIcon } = useShellNavigationLink(props);
</script>

<template>
  <ShellNavigationTooltip v-if="resolvedTarget.href" :label="props.label">
    <template #default="{ activatorProps }">
      <v-list-item
        v-bind="activatorProps"
        class="shell-menu-link-item"
        :title="props.label"
        :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
        :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
        :prepend-icon="resolvedIcon || undefined"
        :disabled="props.disabled"
        :exact="props.exact"
        :aria-label="props.label"
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
