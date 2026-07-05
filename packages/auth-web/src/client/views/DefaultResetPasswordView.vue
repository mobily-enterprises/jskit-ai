<template>
  <div class="reset-screen" :class="{ 'reset-screen--mobile': isMobileViewport }">
    <v-container
      fluid
      class="reset-shell fill-height d-flex"
      :class="[
        isMobileViewport
          ? 'reset-shell--mobile align-stretch justify-stretch pa-0'
          : 'align-center justify-center py-8'
      ]"
    >
      <v-card
        class="reset-card"
        :class="{ 'reset-card--mobile': isMobileViewport }"
        :rounded="isMobileViewport ? false : 'lg'"
        :elevation="isMobileViewport ? 0 : 1"
        :border="!isMobileViewport"
      >
        <v-card-text class="reset-content" :class="{ 'reset-content--mobile': isMobileViewport }">
          <div class="reset-header mb-5">
            <h1 class="reset-title">Reset password</h1>
          </div>

          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
            {{ errorMessage }}
          </v-alert>

          <v-alert v-if="status === 'done'" type="success" variant="tonal" class="mb-4">
            Password updated. Sign in with your new password.
          </v-alert>

          <v-progress-linear v-if="status === 'checking'" indeterminate color="primary" class="mb-4" />

          <v-form v-if="status === 'ready'" @submit.prevent="submitReset" novalidate>
            <v-text-field
              v-model="password"
              label="New password"
              :type="showPassword ? 'text' : 'password'"
              variant="outlined"
              density="comfortable"
              autocomplete="new-password"
              :append-inner-icon="showPassword ? mdiEyeOff : mdiEye"
              :error-messages="passwordError"
              class="mb-3"
              @click:append-inner="showPassword = !showPassword"
            />
            <v-text-field
              v-model="confirmPassword"
              label="Confirm password"
              :type="showConfirmPassword ? 'text' : 'password'"
              variant="outlined"
              density="comfortable"
              autocomplete="new-password"
              :append-inner-icon="showConfirmPassword ? mdiEyeOff : mdiEye"
              :error-messages="confirmPasswordError"
              class="mb-4"
              @click:append-inner="showConfirmPassword = !showConfirmPassword"
            />
            <v-btn block color="primary" size="large" type="submit" :loading="loading" :disabled="!canSubmit">
              Update password
            </v-btn>
          </v-form>

          <div v-if="status === 'done' || status === 'error'" class="mt-4 d-flex justify-end">
            <v-btn variant="text" color="secondary" href="/auth/login">Back to sign in</v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-container>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { mdiEye, mdiEyeOff } from "@mdi/js";
import { useDisplay } from "vuetify";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { authPasswordResetCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetCommand";
import { authHttpRequest } from "../runtime/authHttpClient.js";
import {
  readPasswordRecoveryCallbackPayloadFromUrl,
  stripPasswordRecoveryCallbackParamsFromLocation
} from "../runtime/passwordRecoveryCallbackRuntime.js";
import {
  validateCommandSection,
  resolveFieldValidationMessage
} from "../composables/loginView/validationHelpers.js";

const { mobile: isMobileViewport } = useDisplay({ mobileBreakpoint: 960 });
const status = ref("checking");
const loading = ref(false);
const errorMessage = ref("");
const password = ref("");
const confirmPassword = ref("");
const showPassword = ref(false);
const showConfirmPassword = ref(false);

const resetPasswordPayload = computed(() => ({
  password: password.value
}));
const resetPasswordValidation = computed(() =>
  validateCommandSection(authPasswordResetCommand, "body", resetPasswordPayload.value)
);
const passwordError = computed(() => {
  if (!password.value) {
    return [];
  }
  const message = resolveFieldValidationMessage(resetPasswordValidation.value, "password");
  return message ? [message] : [];
});
const confirmPasswordError = computed(() => {
  if (!confirmPassword.value) {
    return [];
  }
  return password.value === confirmPassword.value ? [] : ["Passwords must match."];
});
const canSubmit = computed(() =>
  Boolean(password.value) &&
  resetPasswordValidation.value.ok === true &&
  password.value === confirmPassword.value &&
  loading.value !== true
);

function readRecoveryPayload() {
  if (typeof window !== "object" || !window.location) {
    return null;
  }
  return readPasswordRecoveryCallbackPayloadFromUrl(window.location.href);
}

async function exchangeRecoveryToken() {
  const recoveryPayload = readRecoveryPayload();
  if (!recoveryPayload) {
    status.value = "ready";
    return;
  }
  try {
    await authHttpRequest(AUTH_PATHS.PASSWORD_RECOVERY, {
      method: "POST",
      body: recoveryPayload
    });
    stripPasswordRecoveryCallbackParamsFromLocation();
    status.value = "ready";
  } catch (error) {
    status.value = "error";
    errorMessage.value = String(error?.message || "Recovery link is invalid or expired.");
  }
}

async function submitReset() {
  if (!canSubmit.value) {
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  try {
    await authHttpRequest(AUTH_PATHS.PASSWORD_RESET, {
      method: "POST",
      body: {
        password: password.value
      }
    });
    status.value = "done";
    password.value = "";
    confirmPassword.value = "";
  } catch (error) {
    errorMessage.value = String(error?.message || "Unable to update password.");
  } finally {
    loading.value = false;
  }
}

onMounted(exchangeRecoveryToken);
</script>

<style scoped>
.reset-screen {
  position: fixed;
  inset: 0;
  z-index: 1;
  overflow-y: auto;
  min-height: 100dvh;
  background-color: rgb(var(--v-theme-background));
}

.reset-shell {
  min-height: 100dvh;
}

.reset-card {
  width: min(480px, 100%);
}

.reset-card--mobile {
  width: 100%;
  min-height: 100dvh;
}

.reset-content {
  padding: 28px;
}

.reset-content--mobile {
  min-height: 100dvh;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 20px calc(32px + env(safe-area-inset-bottom, 0px));
}

.reset-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  color: rgb(var(--v-theme-on-surface));
}
</style>
