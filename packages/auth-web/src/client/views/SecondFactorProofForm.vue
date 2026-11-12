<template>
  <v-form novalidate @submit.prevent="submitProof">
    <v-text-field
      v-if="usingRecoveryCode"
      key="recovery-code"
      v-model="recoveryCode"
      :label="t('jskit.auth.secondFactor.form.recoveryCode')"
      variant="outlined"
      density="comfortable"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      autofocus
      :error-messages="fieldError"
    />
    <v-text-field
      v-else
      key="code"
      v-model="code"
      :label="t('jskit.auth.secondFactor.form.code')"
      variant="outlined"
      density="comfortable"
      inputmode="numeric"
      autocomplete="one-time-code"
      autofocus
      :error-messages="fieldError"
    />
    <v-btn v-if="allowRecoveryCode" variant="text" class="mb-2" @click="toggleRecoveryCode">
      {{ usingRecoveryCode ? t("jskit.auth.secondFactor.form.useCode") : t("jskit.auth.secondFactor.form.useRecoveryCode") }}
    </v-btn>
    <div class="second-factor-proof__actions">
      <slot name="actions" />
      <v-btn type="submit" variant="flat" :color="submitColor" :disabled="!canSubmit">
        {{ submitLabel }}
      </v-btn>
    </div>
  </v-form>
</template>

<script setup>
import { useSecondFactorProof } from "../composables/secondFactor/useSecondFactorProof.js";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  submit: {
    type: /** @type {import("vue").PropType<(proof: import("../types.js").SecondFactorProof) => Promise<unknown>>} */ (Function),
    required: true
  },
  submitLabel: { type: String, required: true },
  submitColor: { type: String, default: "primary" },
  // Setting up an authenticator takes its first code only; every other proof may be a recovery code.
  allowRecoveryCode: { type: Boolean, default: true }
});
const emit = defineEmits(["done"]);

const { t } = useJskitText();
const {
  usingRecoveryCode,
  code,
  recoveryCode,
  fieldError,
  canSubmit,
  toggleRecoveryCode,
  submitProof
} = useSecondFactorProof({
  submit: (proof) => props.submit(proof),
  onDone: (result) => emit("done", result)
});
</script>

<style scoped>
.second-factor-proof__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
