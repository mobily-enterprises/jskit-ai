<template>
  <UiDialog :open="open" :title="t('jskit.auth.secondFactor.prompt.title')" @close="emit('cancel')">
    <p class="text-on-surface-variant mb-4" :class="text.body">{{ t("jskit.auth.secondFactor.prompt.explain") }}</p>
    <v-form :id="formId" novalidate @submit.prevent="proof.submitProof">
      <SecondFactorProofFields
        v-model:code="proof.code"
        v-model:recovery-code="proof.recoveryCode"
        :using-recovery-code="proof.usingRecoveryCode"
        :field-error="proof.fieldError"
        @toggle-recovery-code="proof.toggleRecoveryCode"
      />
    </v-form>
    <template #actions>
      <UiButton emphasis="low" @click="emit('cancel')">{{ t("jskit.auth.secondFactor.cancel") }}</UiButton>
      <UiButton emphasis="high" type="submit" :form="formId" :disabled="!proof.canSubmit">
        {{ t("jskit.auth.secondFactor.confirm") }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script setup>
import { nextTick, reactive, useId, watch } from "vue";
import { useShellUi } from "@jskit-ai/shell-web/client/ui";
import SecondFactorProofFields from "./SecondFactorProofFields.vue";
import { useSecondFactorProof } from "../composables/useSecondFactorProof.js";
import { pageActiveElement } from "../browser.js";
import { useJskitText } from "../i18n.js";
import { verifySecondFactor } from "../runtime/secondFactorRequests.js";

// The step-up dialog: bind `open`, `verified` and `cancel` to useSecondFactorStepUp()'s. It is the kit's Dialog
// (shell-web's UI kit: the application's own, or Material 3's), titled "Confirm it's you", with the code form in its
// body and Cancel and Confirm in its actions; Confirm sits outside the form and submits it by the form's id, so Enter
// in the field submits too. Escape, a click outside and the frame's own close cancel, as Cancel does.
const props = defineProps({
  open: { type: Boolean, required: true }
});
const emit = defineEmits(["verified", "cancel"]);
const { t } = useJskitText();
const { Button: UiButton, Dialog: UiDialog, text } = useShellUi();
const formId = useId();
const proof = reactive(useSecondFactorProof({
  submit: verifySecondFactor,
  onDone: (result) => emit("verified", result)
}));

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
