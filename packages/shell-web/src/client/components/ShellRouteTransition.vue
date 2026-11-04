<script setup>
import { useShellRouteTransition } from "../composables/useShellRouteTransition.js";

const props = defineProps({
  enabled: {
    type: Boolean,
    default: true
  },
  target: {
    type: String,
    default: "shell-layout:primary-bottom-nav"
  },
  semanticTarget: {
    type: String,
    default: "shell.primary-nav"
  },
  swipeEnabled: {
    type: Boolean,
    default: true
  }
});

const { routeTransitionKey, routeTransitionName } = useShellRouteTransition(props);
</script>

<template>
  <div class="shell-route-transition">
    <Transition :name="routeTransitionName" :css="Boolean(routeTransitionName)">
      <div :key="routeTransitionKey" class="shell-route-transition__pane">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.shell-route-transition {
  --shell-route-transition-distance: 100%;
  align-items: stretch;
  --shell-route-transition-opacity: 1;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow-x: clip;
  position: relative;
}

:global(.shell-route-swipe-enabled) {
  touch-action: pan-y;
}

.shell-route-transition__pane {
  background: rgb(var(--v-theme-background));
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}

.shell-route-slide-forward-enter-active,
.shell-route-slide-forward-leave-active,
.shell-route-slide-reverse-enter-active,
.shell-route-slide-reverse-leave-active {
  transition:
    transform 320ms cubic-bezier(0.2, 0, 0, 1),
    opacity 120ms linear;
}

.shell-route-slide-forward-leave-active,
.shell-route-slide-reverse-leave-active {
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  width: 100%;
}

.shell-route-slide-forward-enter-from {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(var(--shell-route-transition-distance));
}

.shell-route-slide-forward-leave-to {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(calc(var(--shell-route-transition-distance) * -1));
}

.shell-route-slide-reverse-enter-from {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(calc(var(--shell-route-transition-distance) * -1));
}

.shell-route-slide-reverse-leave-to {
  opacity: var(--shell-route-transition-opacity);
  transform: translateX(var(--shell-route-transition-distance));
}

@media (prefers-reduced-motion: reduce) {
  .shell-route-slide-forward-enter-active,
  .shell-route-slide-forward-leave-active,
  .shell-route-slide-reverse-enter-active,
  .shell-route-slide-reverse-leave-active {
    transition-duration: 1ms;
  }

  .shell-route-slide-forward-enter-from,
  .shell-route-slide-forward-leave-to,
  .shell-route-slide-reverse-enter-from,
  .shell-route-slide-reverse-leave-to {
    transform: none;
  }
}
</style>
