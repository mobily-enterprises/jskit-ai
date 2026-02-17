<template>
  <v-main class="reset-main">
    <v-container class="fill-height d-flex align-center justify-center py-8">
      <v-card class="reset-card" rounded="lg" elevation="1" border>
        <v-card-text class="pa-8 pa-sm-10">
          <p class="reset-kicker">Account security</p>
          <h1 class="reset-title">Reset your password</h1>
          <p class="text-medium-emphasis mb-6">
            Choose a new password for your account. For security, you will need to sign in again after update.
          </p>

          <div v-if="initializing" class="loading-block">
            <v-progress-circular indeterminate color="primary" size="28" width="3" class="mr-3" />
            <span>Validating recovery link...</span>
          </div>

          <template v-else>
            <v-alert v-if="recoveryError" type="error" variant="tonal" class="mb-4">
              {{ recoveryError }}
            </v-alert>

            <v-alert v-if="formError" type="error" variant="tonal" class="mb-4">
              {{ formError }}
            </v-alert>

            <v-alert v-if="formSuccess" type="success" variant="tonal" class="mb-4">
              {{ formSuccess }}
            </v-alert>

            <v-form v-if="readyForPasswordUpdate && !formSuccess" @submit.prevent="submitPasswordReset" novalidate>
              <v-text-field
                v-model="password"
                label="New password"
                :type="showPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                autocomplete="new-password"
                :error-messages="passwordErrorMessages"
                :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                @click:append-inner="showPassword = !showPassword"
                @blur="passwordTouched = true"
                class="mb-3"
              />

              <v-text-field
                v-model="confirmPassword"
                label="Confirm new password"
                :type="showConfirmPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                autocomplete="new-password"
                :error-messages="confirmPasswordErrorMessages"
                :append-inner-icon="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
                @click:append-inner="showConfirmPassword = !showConfirmPassword"
                @blur="confirmPasswordTouched = true"
                class="mb-4"
              />

              <v-btn block color="primary" size="large" :loading="loading" :disabled="!canSubmit" type="submit">
                Update password
              </v-btn>
            </v-form>

            <div class="actions-row">
              <v-btn v-if="!readyForPasswordUpdate || formSuccess" variant="flat" color="primary" @click="goToLogin">
                Back to sign in
              </v-btn>
              <v-btn v-else variant="text" color="secondary" @click="goToLogin">Cancel</v-btn>
            </div>
          </template>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<script setup>
import { toRefs } from "vue";
import { useResetPasswordView } from "./useResetPasswordView";

const { form, status, validation, actions } = useResetPasswordView();
const { password, confirmPassword, showPassword, showConfirmPassword, passwordTouched, confirmPasswordTouched } =
  toRefs(form);
const { initializing, readyForPasswordUpdate, recoveryError, formError, formSuccess, loading } = toRefs(status);
const { passwordErrorMessages, confirmPasswordErrorMessages, canSubmit } = toRefs(validation);
const { submitPasswordReset, goToLogin } = actions;
</script>

<style scoped>
.reset-main {
  background-color: rgb(var(--v-theme-background));
  background-image: radial-gradient(circle at 12% 10%, rgba(0, 107, 83, 0.12), transparent 34%);
}

.reset-card {
  width: min(560px, 100%);
}

.reset-kicker {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #355347;
}

.reset-title {
  margin: 8px 0 10px;
  font-size: clamp(28px, 4vw, 34px);
  line-height: 1.2;
  color: #1d2c24;
}

.loading-block {
  display: flex;
  align-items: center;
  color: #2f473d;
  margin-bottom: 14px;
}

.actions-row {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
