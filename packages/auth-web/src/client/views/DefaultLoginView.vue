<template>
  <v-main class="login-main">
    <v-container class="fill-height d-flex align-center justify-center py-8">
      <v-card class="auth-card" rounded="lg" elevation="1" border>
        <v-card-text class="pa-7">
          <div class="auth-header d-flex align-start justify-space-between ga-3 mb-5">
            <div>
              <p class="auth-kicker">Jskit Workspace</p>
              <h1 class="auth-title">{{ authTitle }}</h1>
              <p v-if="authSubtitle" class="text-medium-emphasis mb-0">{{ authSubtitle }}</p>
            </div>
            <v-chip color="primary" size="small" label>Secure</v-chip>
          </div>

          <div v-if="!isForgot && !isOtp && !isEmailConfirmationPending" class="mode-switch d-flex ga-2 pa-1 mb-5">
            <v-btn
              data-testid="auth-mode-sign-in"
              class="text-none"
              :variant="isLogin ? 'flat' : 'text'"
              :color="isLogin ? 'primary' : undefined"
              @click="switchMode('login')"
            >
              Sign in
            </v-btn>
            <v-btn
              v-if="!showRememberedAccount"
              data-testid="auth-mode-register"
              class="text-none"
              :variant="isRegister ? 'flat' : 'text'"
              :color="isRegister ? 'primary' : undefined"
              @click="switchMode('register')"
            >
              Register
            </v-btn>
          </div>

          <v-form @submit.prevent="submitAuth" novalidate>
            <template v-if="isEmailConfirmationPending">
              <div class="email-confirmation-state mb-5">
                <p class="email-confirmation-message mb-0">
                  {{ emailConfirmationMessage }}
                </p>
              </div>

              <div class="switch-row d-flex align-center justify-space-between ga-3">
                <v-btn class="text-none" variant="tonal" color="primary" @click="goToMainScreen">
                  Go to main screen
                </v-btn>
                <v-btn
                  class="text-none"
                  variant="outlined"
                  color="secondary"
                  :loading="registerConfirmationResendPending"
                  @click="resendRegisterConfirmationEmail"
                >
                  Resend confirmation email
                </v-btn>
                <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
              </div>
            </template>

            <template v-else>
              <div
                v-if="showRememberedAccount"
                class="remembered-account d-flex align-center justify-space-between ga-3 mb-4"
              >
                <div class="remembered-copy flex-grow-1">
                  <p class="remembered-title">Welcome back, {{ rememberedAccountDisplayName }}</p>
                  <p class="remembered-email">{{ rememberedAccountMaskedEmail }}</p>
                </div>
                <v-btn variant="text" color="secondary" class="text-none" @click="switchAccount">
                  {{ rememberedAccountSwitchLabel }}
                </v-btn>
              </div>

              <v-text-field
                v-model="email"
                label="Email"
                variant="outlined"
                density="comfortable"
                type="email"
                autocomplete="email"
                :error-messages="emailErrorMessages"
                @blur="emailTouched = true"
                class="mb-3"
              />

              <v-text-field
                v-if="!isForgot && !isOtp"
                v-model="password"
                label="Password"
                :type="showPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                :autocomplete="isRegister ? 'new-password' : 'current-password'"
                :error-messages="passwordErrorMessages"
                :append-inner-icon="showPassword ? mdiEyeOff : mdiEye"
                @click:append-inner="togglePasswordVisibility"
                @blur="passwordTouched = true"
                class="mb-3"
              />

              <v-text-field
                v-if="isRegister"
                v-model="confirmPassword"
                label="Confirm password"
                :type="showConfirmPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                autocomplete="new-password"
                :error-messages="confirmPasswordErrorMessages"
                :append-inner-icon="showConfirmPassword ? mdiEyeOff : mdiEye"
                @click:append-inner="toggleConfirmPasswordVisibility"
                @blur="confirmPasswordTouched = true"
                class="mb-3"
              />

              <v-text-field
                v-if="isOtp"
                v-model="otpCode"
                label="One-time code"
                variant="outlined"
                density="comfortable"
                autocomplete="one-time-code"
                :error-messages="otpCodeErrorMessages"
                @blur="otpCodeTouched = true"
                class="mb-3"
              />

              <div v-if="isLogin" class="aux-links d-flex justify-end mb-4">
                <v-btn variant="text" color="secondary" @click="switchMode('forgot')">Forgot password?</v-btn>
                <v-btn variant="text" color="secondary" @click="switchMode('otp')">Use one-time code</v-btn>
              </div>

              <v-checkbox
                v-if="isLogin || isOtp"
                v-model="rememberAccountOnDevice"
                label="Remember this account on this device"
                density="compact"
                hide-details
                class="mb-4"
              />

              <div v-if="isOtp" class="aux-links d-flex justify-end mb-4">
                <v-btn
                  type="button"
                  variant="tonal"
                  color="secondary"
                  :loading="otpRequestPending"
                  @click="requestOtpCode"
                >
                  Send one-time code
                </v-btn>
              </div>

              <div v-if="isLogin || isRegister" class="oauth-actions d-grid ga-2 mb-4">
                <v-btn
                  v-for="provider in oauthProviders"
                  :key="provider.id"
                  block
                  variant="outlined"
                  color="secondary"
                  :disabled="loading"
                  :prepend-icon="oauthProviderIcon(provider)"
                  class="text-none oauth-provider-button"
                  @click="startOAuthSignIn(provider.id)"
                >
                  {{ oauthProviderButtonLabel(provider) }}
                </v-btn>
              </div>
              <v-btn
                data-testid="auth-submit"
                block
                color="primary"
                size="large"
                :loading="loading"
                :disabled="!canSubmit"
                type="submit"
              >
                {{ submitLabel }}
              </v-btn>

              <div v-if="isRegister" class="switch-row mt-4 d-flex align-center justify-space-between ga-3">
                <span class="text-medium-emphasis">Already have an account?</span>
                <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
              </div>

              <div v-else-if="isForgot" class="switch-row mt-4 d-flex align-center justify-space-between ga-3">
                <span class="text-medium-emphasis">Remembered your password?</span>
                <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
              </div>

              <div v-else-if="isOtp" class="switch-row mt-4 d-flex align-center justify-space-between ga-3">
                <span class="text-medium-emphasis">Want to use another method?</span>
                <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
              </div>
            </template>
          </v-form>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<script setup>
import { onMounted } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { mdiEye, mdiEyeOff } from "@mdi/js";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useLoginViewState } from "../composables/loginView/useLoginViewState.js";
import { useLoginViewValidation } from "../composables/loginView/useLoginViewValidation.js";
import { useLoginViewActions } from "../composables/loginView/useLoginViewActions.js";

const {
  context: placementContext
} = useWebPlacementContext();
const queryClient = useQueryClient();
const errorRuntime = useShellWebErrorRuntime();

const state = useLoginViewState({ placementContext });
const validation = useLoginViewValidation({ state });
const actions = useLoginViewActions({
  state,
  validation,
  queryClient,
  errorRuntime
});

onMounted(actions.initializeOnMounted);

const {
  authTitle,
  authSubtitle,
  isForgot,
  isOtp,
  isLogin,
  isRegister,
  isEmailConfirmationPending,
  emailConfirmationMessage,
  showRememberedAccount,
  switchMode,
  goToMainScreen,
  rememberedAccountDisplayName,
  rememberedAccountMaskedEmail,
  rememberedAccountSwitchLabel,
  switchAccount,
  email,
  emailTouched,
  password,
  showPassword,
  passwordTouched,
  confirmPassword,
  showConfirmPassword,
  confirmPasswordTouched,
  otpCode,
  otpCodeTouched,
  rememberAccountOnDevice,
  otpRequestPending,
  registerConfirmationResendPending,
  oauthProviders,
  loading,
  submitLabel
} = state;

const {
  emailErrorMessages,
  passwordErrorMessages,
  confirmPasswordErrorMessages,
  otpCodeErrorMessages,
  canSubmit
} = validation;

const {
  submitAuth,
  requestOtpCode,
  resendRegisterConfirmationEmail,
  oauthProviderIcon,
  startOAuthSignIn,
  oauthProviderButtonLabel
} = actions;

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value;
}

function toggleConfirmPasswordVisibility() {
  showConfirmPassword.value = !showConfirmPassword.value;
}
</script>

<style scoped>
.login-main {
  background-color: rgb(var(--v-theme-background));
  background-image: radial-gradient(circle at 15% 12%, rgba(0, 107, 83, 0.12), transparent 32%);
}

.auth-card {
  width: min(520px, 100%);
}

.auth-kicker {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #395447;
}

.auth-title {
  margin: 0 0 8px;
  font-size: clamp(28px, 3vw, 32px);
  line-height: 1.2;
  color: #1d2c24;
}

.mode-switch {
  border-radius: 12px;
  background-color: rgba(57, 84, 71, 0.08);
}

.email-confirmation-state {
  border-radius: 12px;
  border: 1px solid rgba(57, 84, 71, 0.2);
  background: rgba(57, 84, 71, 0.07);
  padding: 16px;
}

.email-confirmation-message {
  color: #1d2c24;
  line-height: 1.5;
}

.remembered-account {
  border-radius: 12px;
  border: 1px solid rgba(57, 84, 71, 0.2);
  background: rgba(57, 84, 71, 0.07);
  padding: 12px 14px;
}

.remembered-copy {
  min-width: 0;
}

.remembered-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1d2c24;
}

.remembered-email {
  margin: 2px 0 0;
  font-size: 12px;
  color: rgba(29, 44, 36, 0.72);
}

.oauth-provider-button {
  justify-content: center;
}

@media (max-width: 959px) {
  .auth-content {
    padding: 24px 20px;
  }

  .auth-title {
    font-size: 26px;
  }
}
</style>
