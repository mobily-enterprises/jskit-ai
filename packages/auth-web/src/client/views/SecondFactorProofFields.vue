<template>
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
  <UiButton v-if="allowRecoveryCode" emphasis="low" class="mb-2" @click="emit('toggleRecoveryCode')">
    {{ usingRecoveryCode ? t("jskit.auth.secondFactor.form.useCode") : t("jskit.auth.secondFactor.form.useRecoveryCode") }}
  </UiButton>
</template>

<script setup>
import { useShellUi } from "@jskit-ai/shell-web/client/ui";
import { useJskitText } from "../i18n.js";

// A proof form's field and its switch between a code and a recovery code, bound to the form's own
// useSecondFactorProof(), so the form, or a dialog whose actions sit outside the form, keeps its submit beside them.
defineProps({
  usingRecoveryCode: { type: Boolean, required: true },
  fieldError: { type: String, default: "" },
  // Setting up an authenticator takes its first code only; every other proof may be a recovery code.
  allowRecoveryCode: { type: Boolean, default: true }
});
const emit = defineEmits(["toggleRecoveryCode"]);
const code = defineModel("code", { type: String, required: true });
const recoveryCode = defineModel("recoveryCode", { type: String, required: true });

const { t } = useJskitText();
const { Button: UiButton } = useShellUi();
</script>
