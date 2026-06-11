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
  <section class="generated-ui-screen generated-ui-screen--settings settings-general-screen d-flex flex-column ga-4">
    <div>
      <h2 class="text-h6 mb-2">Navigation</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Choose the default behavior for wider screens. Phone layouts keep primary navigation in the bottom bar.
      </p>
    </div>

    <v-switch
      v-model="drawerDefaultOpenModel"
      color="primary"
      inset
      hide-details="auto"
      label="Open drawer by default on wider screens"
    />
  </section>
</template>

<style scoped>
.settings-general-screen :deep(.v-switch) {
  min-height: 48px;
}
</style>
