<script setup>
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";

// A dialog whose Save reports a message that stays until dismissed, with the dialog still open. Its surface draws no
// navigation bar, so on a phone the dialog's actions sit at the bottom of the window, where a snackbar shows. Next
// step adds a history entry, so Back has one to return to (Vuetify's overlays ignore a Back to the page's first entry,
// which the router replaced as it started).
const errorRuntime = useShellWebErrorRuntime();
const route = useRoute();
const dialog = ref(false);
const nextStep = computed(() => ({ query: { step: String(Number(route.query.step || 0) + 1) } }));

function save() {
  errorRuntime.report({
    source: "fixture.dialog-feedback.save",
    message: "Integration settings saved.",
    intent: "action-feedback",
    severity: "success",
    channel: "snackbar",
    persist: true
  });
}
</script>

<template>
  <section class="d-flex ga-2 pa-4">
    <v-btn variant="text" data-testid="fixture-open-dialog" @click="dialog = true">Edit settings</v-btn>
    <RouterLink :to="nextStep">Next step</RouterLink>
    <v-dialog v-model="dialog" max-width="560" scrollable>
      <v-card title="Integration settings" data-testid="fixture-feedback-dialog">
        <v-card-text class="dialog-feedback-page__text">Settings that fill a phone's height.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn data-testid="fixture-dialog-close" @click="dialog = false">Close</v-btn>
          <v-btn data-testid="fixture-dialog-save" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.dialog-feedback-page__text {
  min-height: 1200px;
}
</style>
