<template>
  <v-main class="login-main">
    <v-container class="fill-height d-flex align-center justify-center py-8">
      <v-card class="auth-card" rounded="lg" elevation="1" border>
        <v-card-text class="auth-content">
          <div class="auth-header">
            <div>
              <p class="auth-kicker">Annuity Workspace</p>
              <h1 class="auth-title">{{ authTitle }}</h1>
              <p v-if="authSubtitle" class="text-medium-emphasis mb-0">{{ authSubtitle }}</p>
            </div>
            <v-chip color="primary" size="small" label>Secure</v-chip>
          </div>

          <div v-if="!isForgot && !isOtp" class="mode-switch mb-5">
            <v-btn
              class="text-none"
              :variant="isLogin ? 'flat' : 'text'"
              :color="isLogin ? 'primary' : undefined"
              @click="switchMode('login')"
            >
              Sign in
            </v-btn>
            <v-btn
              v-if="!showRememberedAccount"
              class="text-none"
              :variant="isRegister ? 'flat' : 'text'"
              :color="isRegister ? 'primary' : undefined"
              @click="switchMode('register')"
            >
              Register
            </v-btn>
          </div>

          <v-form @submit.prevent="submitAuth" novalidate>
            <div v-if="showRememberedAccount" class="remembered-account mb-4">
              <div class="remembered-copy">
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
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              @click:append-inner="showPassword = !showPassword"
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
              :append-inner-icon="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
              @click:append-inner="showConfirmPassword = !showConfirmPassword"
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

            <div v-if="isLogin" class="aux-links mb-4">
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

            <div v-if="isOtp" class="aux-links mb-4">
              <v-btn
                type="button"
                variant="tonal"
                color="secondary"
                :loading="otpRequestMutation.isPending.value"
                @click="requestOtpCode"
              >
                Send one-time code
              </v-btn>
            </div>

            <div v-if="isLogin || isRegister" class="oauth-actions mb-4">
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

            <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
              {{ errorMessage }}
            </v-alert>

            <v-alert v-if="infoMessage" type="info" variant="tonal" class="mb-4">
              {{ infoMessage }}
            </v-alert>

            <v-btn block color="primary" size="large" :loading="loading" :disabled="!canSubmit" type="submit">
              {{ submitLabel }}
            </v-btn>

            <div v-if="isRegister" class="switch-row">
              <span class="text-medium-emphasis">Already have an account?</span>
              <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
            </div>

            <div v-else-if="isForgot" class="switch-row">
              <span class="text-medium-emphasis">Remembered your password?</span>
              <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
            </div>

            <div v-else-if="isOtp" class="switch-row">
              <span class="text-medium-emphasis">Want to use another method?</span>
              <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
            </div>
          </v-form>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<script setup>
import { toRefs } from "vue";
import { useLoginView } from "./useLoginView";

const { meta, state, actions } = useLoginView();
const {
  authTitle,
  authSubtitle,
  isLogin,
  isRegister,
  isForgot,
  isOtp,
  showRememberedAccount,
  rememberedAccountDisplayName,
  rememberedAccountMaskedEmail,
  rememberedAccountSwitchLabel,
  email,
  password,
  confirmPassword,
  otpCode,
  showPassword,
  showConfirmPassword,
  emailTouched,
  passwordTouched,
  confirmPasswordTouched,
  otpCodeTouched,
  rememberAccountOnDevice,
  emailErrorMessages,
  passwordErrorMessages,
  confirmPasswordErrorMessages,
  otpCodeErrorMessages,
  otpRequestMutation,
  loading,
  errorMessage,
  infoMessage,
  canSubmit,
  submitLabel
} = toRefs(state);
const { oauthProviders } = meta;
const { switchMode, switchAccount, requestOtpCode, startOAuthSignIn, oauthProviderButtonLabel, oauthProviderIcon, submitAuth } =
  actions;
</script>

<style scoped>
.login-main {
  background-color: rgb(var(--v-theme-background));
  background-image: radial-gradient(circle at 15% 12%, rgba(0, 107, 83, 0.12), transparent 32%);
}

.auth-card {
  width: min(520px, 100%);
}

.auth-content {
  padding: 28px;
}

.auth-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
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
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 12px;
  background-color: rgba(57, 84, 71, 0.08);
}

.aux-links {
  display: flex;
  justify-content: flex-end;
}

.switch-row {
  margin-top: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.remembered-account {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

.oauth-actions {
  display: grid;
  gap: 8px;
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
