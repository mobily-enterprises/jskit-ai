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
import { nextTick, watch } from "vue";
import SecondFactorPrompt from "./SecondFactorPrompt.vue";
import { pageActiveElement } from "../browser.js";
import { useJskitText } from "../i18n.js";

// The step-up dialog: bind `open`, `verified` and `cancel` to useSecondFactorStepUp()'s. Escape and a click outside
// cancel, as the Cancel button does.
const props = defineProps({
  open: { type: Boolean, required: true }
});
const emit = defineEmits(["verified", "cancel"]);
const { t } = useJskitText();

/**
 * A request opens the dialog, not a button of its own, so the dialog has no activator to give focus back to: it keeps
 * the element that had focus when it opened (the control that sent the request) and focuses it again once it closes,
 * verified or cancelled, so a keyboard carries on where it was.
 * @type {HTMLElement | null}
 */
let returnFocusTo = null;
watch(() => props.open, async (open) => {
  if (open) {
    returnFocusTo = /** @type {HTMLElement | null} */ (pageActiveElement());
    return;
  }
  const element = returnFocusTo;
  returnFocusTo = null;
  await nextTick();
  if (element?.isConnected) {
    element.focus({ preventScroll: true });
  }
});
</script>

<style scoped>
.second-factor-dialog {
  padding: 24px;
}
</style>
