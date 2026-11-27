<script setup>
import { nextTick, ref, useId, watch } from "vue";
import { useJskitText } from "@jskit-ai/kernel/client";
import { useSecondFactorProof } from "@jskit-ai/auth-web/client/composables/useSecondFactorProof";
import { verifySecondFactor } from "@jskit-ai/auth-web/client/runtime/secondFactorRequests";

// The step-up prompt in the app's own design: a native <dialog>, whose page behind it is inert while it is open and
// whose Escape cancels, over the form useSecondFactorProof() runs, the one JSKIT's SecondFactorDialog renders in
// Material 3. Bind `open`, `verified` and `cancel` to useSecondFactorStepUp()'s. A refused code shows beside the field.
const props = defineProps({
  open: { type: Boolean, required: true }
});
const emit = defineEmits(["verified", "cancel"]);
const { t } = useJskitText();
const id = useId();
const dialog = ref(null);
const field = ref(null);
const { usingRecoveryCode, code, recoveryCode, fieldError, canSubmit, toggleRecoveryCode, reset, submitProof } =
  useSecondFactorProof({
    submit: verifySecondFactor,
    onDone: (result) => emit("verified", result)
  });

// The dialog stays mounted between step-ups, so each opening starts its form afresh (the authenticator's code, nothing
// typed, no refusal) before it renders; the dialog then shows, focusing that field.
watch(() => props.open, (open) => {
  if (open) {
    reset();
  }
});

watch(() => props.open, (open) => {
  if (open) {
    dialog.value?.showModal();
  } else {
    dialog.value?.close();
  }
}, { flush: "post" });

async function switchCodeKind() {
  toggleRecoveryCode();
  await nextTick();
  field.value?.focus();
}
</script>

<template>
  <!-- Escape asks the page to cancel; the dialog closes when `open` turns false, so the page decides. -->
  <dialog ref="dialog" class="confirm-dialog" :aria-labelledby="`${id}-title`" @cancel.prevent="emit('cancel')">
    <form class="confirm-dialog__form" novalidate @submit.prevent="submitProof">
      <h2 :id="`${id}-title`" class="confirm-dialog__title">{{ t("jskit.auth.secondFactor.prompt.title") }}</h2>
      <p class="confirm-dialog__muted">{{ t("jskit.auth.secondFactor.prompt.explain") }}</p>
      <label :for="`${id}-code`">
        {{ usingRecoveryCode ? t("jskit.auth.secondFactor.form.recoveryCode") : t("jskit.auth.secondFactor.form.code") }}
      </label>
      <input
        v-if="usingRecoveryCode"
        :id="`${id}-code`"
        key="recovery-code"
        ref="field"
        v-model="recoveryCode"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :aria-invalid="Boolean(fieldError)"
        :aria-describedby="`${id}-error`"
        autofocus
      >
      <input
        v-else
        :id="`${id}-code`"
        key="code"
        ref="field"
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        :aria-invalid="Boolean(fieldError)"
        :aria-describedby="`${id}-error`"
        autofocus
      >
      <p :id="`${id}-error`" class="confirm-dialog__error">{{ fieldError }}</p>
      <button class="confirm-dialog__link" type="button" @click="switchCodeKind">
        {{ usingRecoveryCode ? t("jskit.auth.secondFactor.form.useCode") : t("jskit.auth.secondFactor.form.useRecoveryCode") }}
      </button>
      <div class="confirm-dialog__actions">
        <button class="confirm-dialog__button" type="button" @click="emit('cancel')">{{ t("jskit.auth.secondFactor.cancel") }}</button>
        <button class="confirm-dialog__button confirm-dialog__button--primary" type="submit" :disabled="!canSubmit">
          {{ t("jskit.auth.secondFactor.confirm") }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.confirm-dialog {
  width: min(400px, calc(100vw - 32px));
  padding: 24px;
  border: 0;
  border-radius: var(--ds-radius-large);
  background: var(--ds-panel);
  color: var(--ds-text);
  font-family: var(--ds-font);
}

.confirm-dialog::backdrop {
  background: var(--ds-scrim);
}

.confirm-dialog__form {
  display: grid;
  gap: 8px;
}

.confirm-dialog__title {
  margin: 0;
  font-size: 1.25rem;
}

.confirm-dialog__muted,
.confirm-dialog__error {
  margin: 0;
}

.confirm-dialog__muted {
  color: var(--ds-text-muted);
}

.confirm-dialog__form label {
  font-weight: 600;
}

.confirm-dialog__form input {
  padding: 10px 12px;
  border: 1px solid var(--ds-line);
  border-radius: var(--ds-radius);
  background: var(--ds-panel);
  color: inherit;
  font: inherit;
}

.confirm-dialog__form input[aria-invalid="true"] {
  border-color: var(--ds-danger);
}

.confirm-dialog__error {
  min-height: 1.25em;
  color: var(--ds-danger);
  font-size: 0.875rem;
}

.confirm-dialog__link {
  justify-self: start;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--ds-accent);
  font: inherit;
  cursor: pointer;
}

.confirm-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.confirm-dialog__button {
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--ds-line);
  border-radius: var(--ds-radius);
  background: var(--ds-panel);
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.confirm-dialog__button--primary {
  border-color: var(--ds-accent);
  background: var(--ds-accent);
  color: var(--ds-on-accent);
}

.confirm-dialog__button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
