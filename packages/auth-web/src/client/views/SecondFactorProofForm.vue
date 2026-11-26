<template>
  <v-form :id="formId" novalidate @submit.prevent="proof.submitProof">
    <SecondFactorProofFields
      v-model:code="proof.code"
      v-model:recovery-code="proof.recoveryCode"
      :using-recovery-code="proof.usingRecoveryCode"
      :field-error="proof.fieldError"
      :allow-recovery-code="allowRecoveryCode"
      @toggle-recovery-code="proof.toggleRecoveryCode"
    />
    <div class="second-factor-proof__actions">
      <slot name="actions" />
      <UiButton type="submit" emphasis="high" :tone="danger ? 'danger' : 'accent'" :disabled="!proof.canSubmit">
        {{ submitLabel }}
      </UiButton>
    </div>
  </v-form>
</template>

<script setup>
import { reactive } from "vue";
import { useShellUi } from "@jskit-ai/shell-web/client/ui";
import SecondFactorProofFields from "./SecondFactorProofFields.vue";
import { useSecondFactorProof } from "../composables/useSecondFactorProof.js";

const props = defineProps({
  submit: {
    type: /** @type {import("vue").PropType<(proof: import("../types.js").SecondFactorProof) => Promise<unknown>>} */ (Function),
    required: true
  },
  submitLabel: { type: String, required: true },
  // The submit removes something, in the kit's danger tone.
  danger: { type: Boolean, default: false },
  // Setting up an authenticator takes its first code only; every other proof may be a recovery code.
  allowRecoveryCode: { type: Boolean, default: true },
  formId: { type: String, default: undefined }
});
const emit = defineEmits(["done"]);

const { Button: UiButton } = useShellUi();
const proof = reactive(useSecondFactorProof({
  submit: (value) => props.submit(value),
  onDone: (result) => emit("done", result)
}));
</script>

<style scoped>
.second-factor-proof__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
