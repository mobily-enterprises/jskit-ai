<template>
  <div class="second-factor-settings">
    <div v-if="step === 'codes'">
      <h2 ref="stepStart" tabindex="-1" class="text-title-medium mb-2">{{ t("jskit.auth.secondFactor.codes.title") }}</h2>
      <p class="text-body-medium text-on-surface-variant mb-4">{{ t("jskit.auth.secondFactor.codes.explain") }}</p>
      <ul class="second-factor-settings__codes text-body-large mb-4" :aria-label="t('jskit.auth.secondFactor.codes.listLabel')">
        <li v-for="recoveryCode in recoveryCodes" :key="recoveryCode">{{ recoveryCode }}</li>
      </ul>
      <div class="second-factor-settings__actions">
        <v-btn v-if="canCopy" variant="text" prepend-icon="$contentCopy" @click="copy(recoveryCodes.join('\n'))">
          {{ t("jskit.auth.secondFactor.codes.copy") }}
        </v-btn>
        <v-btn color="primary" variant="flat" @click="onCodesSaved">{{ t("jskit.auth.secondFactor.codes.saved") }}</v-btn>
      </div>
    </div>

    <v-skeleton-loader v-else-if="load === 'loading'" type="list-item-two-line, actions" />

    <div v-else-if="load === 'error'">
      <v-icon icon="$error" color="error" class="mb-2" />
      <p class="text-body-medium mb-4">{{ t("jskit.auth.secondFactor.settings.loadFailed") }}</p>
      <v-btn color="primary" variant="tonal" prepend-icon="$refresh" @click="reload">
        {{ t("jskit.auth.secondFactor.settings.retry") }}
      </v-btn>
    </div>

    <div v-else-if="step === 'setup'">
      <h2 class="text-title-medium mb-2">{{ t("jskit.auth.secondFactor.setup.title") }}</h2>
      <p class="text-body-medium text-on-surface-variant mb-4">{{ t("jskit.auth.secondFactor.setup.scan") }}</p>
      <!-- A QR code is content, not chrome: dark modules on white in both schemes, as scanners read it. -->
      <svg
        class="second-factor-settings__qr mb-4"
        role="img"
        :aria-label="t('jskit.auth.secondFactor.setup.qrLabel', { account: setup.accountName })"
        :viewBox="`0 0 ${qrCode.size} ${qrCode.size}`"
        shape-rendering="crispEdges"
      >
        <rect :width="qrCode.size" :height="qrCode.size" fill="white" />
        <path :d="qrCode.path" fill="black" />
      </svg>
      <p class="text-body-medium text-on-surface-variant mb-1">{{ t("jskit.auth.secondFactor.setup.typeKey") }}</p>
      <div class="second-factor-settings__secret-row mb-4">
        <code class="second-factor-settings__secret text-body-large">{{ secretText }}</code>
        <v-btn v-if="canCopy" variant="text" prepend-icon="$contentCopy" @click="copy(setup.secret)">
          {{ t("jskit.auth.secondFactor.setup.copyKey") }}
        </v-btn>
      </div>
      <p class="text-body-medium text-on-surface-variant mb-4">{{ t("jskit.auth.secondFactor.setup.enterCode") }}</p>
      <SecondFactorProofForm
        :submit="confirmSecondFactorSetup"
        :submit-label="t('jskit.auth.secondFactor.confirm')"
        :allow-recovery-code="false"
        @done="onRecoveryCodes"
      >
        <template #actions>
          <v-btn variant="text" @click="backToStatus">{{ t("jskit.auth.secondFactor.cancel") }}</v-btn>
        </template>
      </SecondFactorProofForm>
    </div>

    <div v-else-if="step === 'replaceCodes'">
      <p class="text-body-medium text-on-surface-variant mb-4">{{ t("jskit.auth.secondFactor.replace.explain") }}</p>
      <SecondFactorProofForm
        :submit="replaceSecondFactorRecoveryCodes"
        :submit-label="t('jskit.auth.secondFactor.replace.submit')"
        @done="onRecoveryCodes"
      >
        <template #actions>
          <v-btn variant="text" @click="backToStatus">{{ t("jskit.auth.secondFactor.cancel") }}</v-btn>
        </template>
      </SecondFactorProofForm>
    </div>

    <div v-else-if="step === 'remove'">
      <p class="text-body-medium text-on-surface-variant mb-4">{{ t("jskit.auth.secondFactor.remove.explain") }}</p>
      <SecondFactorProofForm
        :submit="removeSecondFactor"
        submit-color="error"
        :submit-label="t('jskit.auth.secondFactor.settings.remove')"
        @done="removed"
      >
        <template #actions>
          <v-btn variant="text" @click="backToStatus">{{ t("jskit.auth.secondFactor.cancel") }}</v-btn>
        </template>
      </SecondFactorProofForm>
    </div>

    <div v-else-if="status.enrolled">
      <p ref="stepStart" tabindex="-1" class="text-body-large mb-1">
        {{ t("jskit.auth.secondFactor.settings.on", { date: formatDate(status.enrolledAt) }) }}
      </p>
      <p
        class="text-body-medium mb-4"
        :class="status.recoveryCodesLeft > 0 ? 'text-on-surface-variant' : 'text-error'"
      >
        {{ t("jskit.auth.secondFactor.settings.codesLeft", { count: status.recoveryCodesLeft }) }}
      </p>
      <div class="second-factor-settings__actions">
        <v-btn variant="text" color="error" @click="showStep('remove')">{{ t("jskit.auth.secondFactor.settings.remove") }}</v-btn>
        <v-btn variant="tonal" color="primary" @click="showStep('replaceCodes')">
          {{ t("jskit.auth.secondFactor.settings.newCodes") }}
        </v-btn>
      </div>
    </div>

    <div v-else>
      <p ref="stepStart" tabindex="-1" class="text-body-medium text-on-surface-variant mb-4">
        {{ t("jskit.auth.secondFactor.settings.off") }}
      </p>
      <v-btn color="primary" variant="flat" :disabled="starting" @click="startSetup">
        {{ t("jskit.auth.secondFactor.settings.setUp") }}
      </v-btn>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref } from "vue";
import SecondFactorProofForm from "./SecondFactorProofForm.vue";
import { useSecondFactorSettings } from "../composables/secondFactor/useSecondFactorSettings.js";
import { useJskitText } from "../i18n.js";
import {
  confirmSecondFactorSetup,
  removeSecondFactor,
  replaceSecondFactorRecoveryCodes
} from "../runtime/secondFactorRequests.js";

// The signed-in person's authenticator app: setting one up, its recovery codes, and removing it. An account settings
// section places it; the section's title names it.
const { formatDate, t } = useJskitText();
const {
  load,
  status,
  step,
  setup,
  qrCode,
  secretText,
  recoveryCodes,
  starting,
  canCopy,
  reload,
  startSetup,
  showRecoveryCodes,
  codesSaved,
  removed,
  showStep,
  copy
} = useSecondFactorSettings();

// After a step ends, focus moves to the start of the next, so a keyboard or screen reader carries on from there.
const stepStart = ref(null);
async function focusStep() {
  await nextTick();
  if (stepStart.value) {
    stepStart.value.focus();
  }
}

function onRecoveryCodes(result) {
  showRecoveryCodes(result);
  void focusStep();
}

function onCodesSaved() {
  codesSaved();
  void focusStep();
}

function backToStatus() {
  showStep("status");
  void focusStep();
}
</script>

<style scoped>
.second-factor-settings__actions,
.second-factor-settings__secret-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.second-factor-settings__actions {
  justify-content: flex-end;
}

.second-factor-settings__qr {
  display: block;
  width: min(200px, 100%);
  height: auto;
}

.second-factor-settings__secret {
  font-family: ui-monospace, monospace;
  overflow-wrap: anywhere;
  user-select: all;
}

.second-factor-settings__codes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12ch, 1fr));
  gap: 8px 24px;
  padding: 0;
  list-style: none;
  font-family: ui-monospace, monospace;
}

[tabindex="-1"]:focus {
  outline: none;
}
</style>
