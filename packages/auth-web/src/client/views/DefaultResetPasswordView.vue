<template>
  <AuthScreen class="reset-screen" :class="{ 'reset-screen--mobile': isMobileViewport }">
    <template v-if="$slots.brand" #brand="brand">
      <slot name="brand" v-bind="brand" />
    </template>
    <v-card
      class="reset-card"
      :class="{ 'reset-card--mobile': isMobileViewport }"
      variant="flat"
      :rounded="isMobileViewport ? false : undefined"
    >
      <v-card-text class="reset-content" :class="{ 'reset-content--mobile': isMobileViewport }">
        <div class="reset-header mb-5">
          <h1 class="reset-title text-headline-medium">{{ t("jskit.auth.resetPassword.title") }}</h1>
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
            :append-inner-icon="showPassword ? '$visibilityOff' : '$visibility'"
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
            :append-inner-icon="showConfirmPassword ? '$visibilityOff' : '$visibility'"
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
  </AuthScreen>
</template>

<script setup>
import { useDisplay } from "vuetify";
import AuthScreen from "./AuthScreen.vue";
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
.reset-card {
  width: min(480px, 100%);
}

/* On a phone the card is the screen below the brand row, if any. */
.reset-card--mobile {
  flex: 1 0 auto;
  width: 100%;
}

.reset-content {
  padding: 28px;
}

.reset-content--mobile {
  padding: calc(24px + var(--auth-screen-top-inset, 0px)) 20px calc(32px + env(safe-area-inset-bottom, 0px));
}

.reset-title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
}
</style>
