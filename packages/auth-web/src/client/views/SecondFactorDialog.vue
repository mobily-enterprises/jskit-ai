<template>
  <v-dialog
    :model-value="open"
    max-width="440"
    :aria-label="t('jskit.auth.secondFactor.prompt.title')"
    @update:model-value="(shown) => shown || emit('cancel')"
  >
    <v-card>
      <v-card-text class="second-factor-dialog">
        <SecondFactorPrompt @verified="(result) => emit('verified', result)">
          <template #actions>
            <v-btn variant="text" @click="emit('cancel')">{{ t("jskit.auth.secondFactor.cancel") }}</v-btn>
          </template>
        </SecondFactorPrompt>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import SecondFactorPrompt from "./SecondFactorPrompt.vue";
import { useJskitText } from "../i18n.js";

// The step-up dialog: bind `open`, `verified` and `cancel` to useSecondFactorStepUp()'s. Escape and a click outside
// cancel, as the Cancel button does.
defineProps({
  open: { type: Boolean, required: true }
});
const emit = defineEmits(["verified", "cancel"]);
const { t } = useJskitText();
</script>

<style scoped>
.second-factor-dialog {
  padding: 24px;
}
</style>
