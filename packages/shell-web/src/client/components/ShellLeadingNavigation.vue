<script setup>
import { computed, toRef } from "vue";
import { mdiArrowLeft, mdiMenu } from "@mdi/js";
import { useShellLeadingNavigation } from "../composables/useShellLeadingNavigation.js";

const props = defineProps({
  menuAvailable: {
    type: Boolean,
    default: false
  },
  backLabel: {
    type: String,
    default: "Back"
  },
  menuLabel: {
    type: String,
    default: "Open navigation menu"
  }
});
const emit = defineEmits(["open-menu"]);

const {
  mode,
  busy,
  label,
  predictiveProgress,
  activate
} = useShellLeadingNavigation({
  menuAvailable: toRef(props, "menuAvailable"),
  backLabel: toRef(props, "backLabel"),
  menuLabel: toRef(props, "menuLabel"),
  openMenu() {
    emit("open-menu");
  }
});

const icon = computed(() => (mode.value === "back" ? mdiArrowLeft : mdiMenu));
</script>

<template>
  <div
    class="shell-leading-navigation"
    :data-mode="mode"
    :style="predictiveProgress == null ? undefined : { '--shell-predictive-back-progress': predictiveProgress }"
  >
    <v-tooltip v-if="mode !== 'none'" :text="label" location="bottom">
      <template #activator="{ props: tooltipProps }">
        <transition name="shell-leading-icon" mode="out-in">
          <v-app-bar-nav-icon
            :key="mode"
            v-bind="tooltipProps"
            class="shell-leading-navigation__control"
            :class="`shell-leading-navigation__control--${mode}`"
            :icon="icon"
            :aria-label="label"
            :aria-busy="busy ? 'true' : undefined"
            :disabled="busy"
            data-testid="jskit-shell-leading-navigation"
            @click="activate"
          />
        </transition>
      </template>
    </v-tooltip>
  </div>
</template>

<style scoped>
.shell-leading-navigation {
  align-items: center;
  display: flex;
  flex: 0 0 48px;
  height: 48px;
  justify-content: center;
  width: 48px;
}

.shell-leading-navigation__control {
  min-height: 48px;
  min-width: 48px;
}

:global(html[dir="rtl"] .shell-leading-navigation__control--back .v-icon) {
  transform: scaleX(-1);
}

.shell-leading-icon-enter-active,
.shell-leading-icon-leave-active {
  transition:
    opacity 120ms cubic-bezier(0.2, 0, 0, 1),
    transform 120ms cubic-bezier(0.2, 0, 0, 1);
}

.shell-leading-icon-enter-from,
.shell-leading-icon-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

@media (prefers-reduced-motion: reduce) {
  .shell-leading-icon-enter-active,
  .shell-leading-icon-leave-active {
    transition: none;
  }
}
</style>
