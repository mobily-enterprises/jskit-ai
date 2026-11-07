<script setup>
import { reactive } from "vue";
import ShellPageAction from "@jskit-ai/shell-web/client/components/ShellPageAction";
import ShellPageActions from "@jskit-ai/shell-web/client/components/ShellPageActions";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";

// Every press reports a success snackbar, as a saved form does, and counts, so a test sees each press that landed.
// The form's Save sits at the bottom end of the content, right above the FAB, where a snackbar could cover them.
const errorRuntime = useShellWebErrorRuntime();
const presses = reactive({ bar: 0, form: 0, fab: 0 });

function press(name) {
  presses[name] += 1;
  errorRuntime.report({
    source: `fixture.feedback.${name}`,
    message: "Integration configuration saved.",
    intent: "action-feedback",
    severity: "success",
    channel: "snackbar"
  });
}
</script>

<template>
  <section class="feedback-page" data-testid="fixture-feedback">
    <ShellPageActions>
      <ShellPageAction primary label="Save" data-testid="fixture-bar-save" @click="press('bar')" />
    </ShellPageActions>
    <output class="text-body-medium pa-4" data-testid="fixture-presses">{{ presses.bar }} {{ presses.form }} {{ presses.fab }}</output>
    <v-card class="ma-4">
      <v-card-text>
        <v-text-field label="Name" model-value="Ada" hide-details />
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn color="primary" variant="flat" data-testid="fixture-form-save" @click="press('form')">Save</v-btn>
      </v-card-actions>
    </v-card>
    <v-fab
      app
      layout
      extended
      location="bottom end"
      order="1"
      prepend-icon="$add"
      text="New"
      data-testid="fixture-feedback-fab"
      @click="press('fab')"
    />
  </section>
</template>

<style scoped>
.feedback-page {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));
}
</style>
