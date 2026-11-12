<template>
  <section class="second-factor-prompt" :aria-labelledby="titleId">
    <h2 :id="titleId" class="text-title-large mb-2">{{ t("jskit.auth.secondFactor.prompt.title") }}</h2>
    <p class="text-body-medium text-on-surface-variant mb-4">{{ t("jskit.auth.secondFactor.prompt.explain") }}</p>
    <SecondFactorProofForm
      :submit="verifySecondFactor"
      :submit-label="t('jskit.auth.secondFactor.confirm')"
      @done="(result) => emit('verified', result)"
    >
      <template #actions>
        <slot name="actions" />
      </template>
    </SecondFactorProofForm>
  </section>
</template>

<script setup>
import { useId } from "vue";
import SecondFactorProofForm from "./SecondFactorProofForm.vue";
import { useJskitText } from "../i18n.js";
import { verifySecondFactor } from "../runtime/secondFactorRequests.js";

// Proves this session's second factor with a code from the authenticator app or a recovery code.
const emit = defineEmits(["verified"]);
const { t } = useJskitText();
const titleId = useId();
</script>
