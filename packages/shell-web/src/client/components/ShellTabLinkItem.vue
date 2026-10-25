<script setup>
import {
  shellNavigationLinkProps,
  useShellNavigationLink
} from "../composables/useShellNavigationLink.js";

const props = defineProps(shellNavigationLinkProps);
const { resolvedTarget, resolvedIcon } = useShellNavigationLink(props);
</script>

<template>
  <v-btn
    v-if="resolvedTarget.href"
    class="tab-link-item text-none"
    :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
    :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
    :disabled="props.disabled"
    :exact="props.exact"
    min-width="72"
    stacked
  >
    <v-icon v-if="resolvedIcon" :icon="resolvedIcon" />
    <span class="tab-link-item__label">{{ props.label || "Tab" }}</span>
  </v-btn>
</template>

<style scoped>
.tab-link-item {
  flex: 0 0 auto;
  min-height: 48px;
}

.tab-link-item__label {
  max-width: 5.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
