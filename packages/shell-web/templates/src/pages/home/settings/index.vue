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
  <section class="d-flex flex-column ga-4">
    <div>
      <h2 class="text-h6 mb-2">Shell settings</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">These starter settings live in this browser only.</p>
    </div>

    <v-switch
      v-model="drawerDefaultOpenModel"
      color="primary"
      inset
      hide-details="auto"
      label="Open navigation drawer by default"
    />

    <p class="text-body-2 text-medium-emphasis mb-0">
      This tiny example exists to prove that shell-level settings can work without auth or a database. Real apps will
      usually replace it.
    </p>
  </section>
</template>
