<template>
  <v-fade-transition>
    <div v-if="isVisible" class="global-network-activity-bar" data-testid="global-network-activity-bar">
      <v-progress-linear indeterminate color="primary" bg-color="primary" :bg-opacity="16" :height="3" />
    </div>
  </v-fade-transition>
</template>

<script setup>
import { useGlobalNetworkActivity } from "@jskit-ai/web-runtime-core";

const { isVisible } = useGlobalNetworkActivity({
  delayMs: 120,
  minVisibleMs: 280
});
</script>

<style scoped>
.global-network-activity-bar {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 2000;
  pointer-events: none;
}
</style>
