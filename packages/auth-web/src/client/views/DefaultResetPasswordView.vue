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
            <h1 class="reset-title">{{ t("jskit.auth.resetPassword.title") }}</h1>
          </div>

          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
            {{ errorMessage }}
          </v-alert>

          <v-alert v-if="status === 'done'" type="success" variant="tonal" class="mb-4">
            {{ t("jskit.auth.resetPassword.done") }}
          </v-alert>

          <v-progress-linear v-if="status === 'checking'" indeterminate color="primary" class="mb-4" />

          <v-form v-if="status === 'ready'" @submit.prevent="submitReset" novalidate>
            <v-text-field
              v-model="password"
              :label="t('jskit.auth.resetPassword.newPassword')"
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
              :label="t('jskit.auth.resetPassword.confirmPassword')"
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
              {{ t("jskit.auth.resetPassword.submit") }}
            </v-btn>
          </v-form>

          <div v-if="status === 'done' || status === 'error'" class="mt-4 d-flex justify-end">
            <v-btn variant="text" color="secondary" href="/auth/login">
              {{ t("jskit.auth.resetPassword.backToSignIn") }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-container>
  </div>
</template>

<script setup>
import { mdiEye, mdiEyeOff } from "@mdi/js";
import { useDisplay } from "vuetify";
import { useDefaultResetPasswordView } from "../composables/useDefaultResetPasswordView.js";
import { useJskitText } from "../i18n.js";

const { mobile: isMobileViewport } = useDisplay({ mobileBreakpoint: 960 });
const { t } = useJskitText();
const {
  status,
  loading,
  errorMessage,
  password,
  confirmPassword,
  showPassword,
  showConfirmPassword,
  passwordError,
  confirmPasswordError,
  canSubmit,
  submitReset
} = useDefaultResetPasswordView();
</script>

<style scoped>
.reset-screen {
  /* Start below shell banners shown on a surface without an app bar. */
  --auth-screen-height: calc(100dvh - var(--shell-error-banners-inline-height, 0px));
  position: fixed;
  inset: var(--shell-error-banners-inline-height, 0px) 0 0;
  z-index: 1;
  overflow-y: auto;
  min-height: var(--auth-screen-height);
  background-color: rgb(var(--v-theme-background));
}

.reset-shell {
  min-height: var(--auth-screen-height);
}

.reset-card {
  width: min(480px, 100%);
}

.reset-card--mobile {
  width: 100%;
  min-height: var(--auth-screen-height);
}

.reset-content {
  padding: 28px;
}

.reset-content--mobile {
  min-height: var(--auth-screen-height);
  padding: calc(24px + env(safe-area-inset-top, 0px)) 20px calc(32px + env(safe-area-inset-bottom, 0px));
}

.reset-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  color: rgb(var(--v-theme-on-surface));
}
</style>
