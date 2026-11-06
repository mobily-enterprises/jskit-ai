<script setup>
import { computed } from "vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  runtime: {
    type: /** @type {import("vue").PropType<import("../types.js").RewardedRuntime>} */ (Object),
    required: true
  }
});

const { t } = useJskitText();
const state = computed(() => props.runtime.state);
const isVisible = computed(() => state.value.open === true && state.value.phase !== "showing-ad");
const titleText = computed(() => state.value.gateState?.rule?.title || t("jskit.rewarded.gate.defaultTitle"));
const descriptionText = computed(() =>
  state.value.gateState?.rule?.description ||
  t("jskit.rewarded.gate.defaultDescription")
);

function handleWatchClick() {
  props.runtime.beginWatch();
}

function handleCancelClick() {
  props.runtime.cancelPrompt();
}

function handleDismissError() {
  props.runtime.dismissError();
}
</script>

<template>
  <!-- A Material 3 basic dialog: the gate waits for the person's choice, so the scrim does not dismiss it. -->
  <v-dialog :model-value="isVisible" class="rewarded-gate" persistent max-width="560">
    <v-card>
      <v-card-item>
        <div class="rewarded-gate__eyebrow text-label-large">{{ t("jskit.rewarded.gate.eyebrow") }}</div>
        <h2 class="rewarded-gate__title text-headline-small">{{ titleText }}</h2>
      </v-card-item>
      <v-card-text>
        <p class="text-body-medium on-surface-variant mb-0">{{ descriptionText }}</p>

        <p v-if="state.phase === 'loading'" class="rewarded-gate__status text-body-medium">
          {{ t("jskit.rewarded.gate.loading") }}
        </p>

        <p v-else-if="state.phase === 'error'" class="rewarded-gate__status text-body-medium text-error">
          {{ state.errorMessage || t("jskit.rewarded.gate.startFailed") }}
        </p>
      </v-card-text>

      <v-card-actions v-if="state.phase === 'prompt' || state.phase === 'error'">
        <v-spacer />
        <v-btn v-if="state.phase === 'prompt'" variant="text" @click="handleCancelClick">
          {{ t("jskit.rewarded.gate.notNow") }}
        </v-btn>
        <v-btn v-if="state.phase === 'prompt'" variant="text" @click="handleWatchClick">
          {{ t("jskit.rewarded.gate.watch") }}
        </v-btn>
        <v-btn v-if="state.phase === 'error'" variant="text" @click="handleDismissError">
          {{ t("jskit.rewarded.gate.close") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.rewarded-gate__eyebrow {
  color: rgb(var(--v-theme-primary));
}

.rewarded-gate__title {
  margin: 0.5rem 0 0;
  white-space: normal;
}

.rewarded-gate__status {
  margin: 1rem 0 0;
}
</style>
