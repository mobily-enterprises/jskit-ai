<script setup>
import { computed } from "vue";
import { useShellLayoutState } from "@jskit-ai/shell-web/client/composables/useShellLayoutState";

const { drawerDefaultOpen, setDrawerDefaultOpen } = useShellLayoutState();

const drawerDefaultOpenModel = computed({
  get() {
    return drawerDefaultOpen.value;
  },
  set(value) {
    setDrawerDefaultOpen(Boolean(value));
  }
});
</script>

<template>
  <section class="settings-general-screen d-flex flex-column ga-4">
    <div>
      <h2 class="text-h6 mb-2">Navigation</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        On wider screens, collapsed navigation remains available as a rail. Phone layouts close the drawer and keep primary navigation in the bottom bar.
      </p>
    </div>

    <v-switch
      v-model="drawerDefaultOpenModel"
      color="primary"
      inset
      hide-details="auto"
      label="Start with expanded navigation on wider screens"
    />
  </section>
</template>

<style scoped>
.settings-general-screen :deep(.v-switch) {
  min-height: 48px;
}
</style>
