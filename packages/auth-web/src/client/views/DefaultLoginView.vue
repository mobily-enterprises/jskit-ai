<template>
  <AuthScreen class="login-screen" :class="{ 'login-screen--mobile': isMobileViewport }">
    <template v-if="$slots.brand" #brand="brand">
      <slot name="brand" v-bind="brand" />
    </template>
    <v-card
      class="auth-card"
      :class="{ 'auth-card--mobile': isMobileViewport }"
      variant="flat"
      :rounded="isMobileViewport ? false : undefined"
    >
      <v-card-text class="auth-content" :class="{ 'auth-content--mobile': isMobileViewport }">
        <div v-if="authTitle || authSubtitle" class="auth-header mb-5">
          <div>
            <h1 v-if="authTitle" class="auth-title text-headline-medium">{{ authTitle }}</h1>
            <p v-if="authSubtitle" class="on-surface-variant mb-0">{{ authSubtitle }}</p>
          </div>
        </div>

        <div v-if="!isForgot && !isOtp && !isEmailConfirmationPending" class="mode-switch d-flex ga-2 pa-1 mb-5">
          <v-btn
            data-testid="auth-mode-sign-in"
            class="text-none"
            :variant="isLogin ? 'flat' : 'text'"
            :color="isLogin ? 'secondary-container' : undefined"
            @click="switchMode('login')"
          >
            {{ t("jskit.auth.login.mode.signIn") }}
          </v-btn>
          <v-btn
            v-if="!showRememberedAccount && canRegister"
            data-testid="auth-mode-register"
            class="text-none"
            :variant="isRegister ? 'flat' : 'text'"
            :color="isRegister ? 'secondary-container' : undefined"
            @click="switchMode('register')"
          >
            {{ t("jskit.auth.login.mode.register") }}
          </v-btn>
        </div>

        <v-form @submit.prevent="submitAuth" novalidate>
          <template v-if="isEmailConfirmationPending">
            <div class="email-confirmation-state mb-5">
              <p class="email-confirmation-message text-body-medium mb-0">
                {{ emailConfirmationMessage }}
              </p>
            </div>

            <div v-if="confirmationUrl" class="email-confirmation-dev-link mb-5" data-testid="auth-confirmation-dev-link">
              <p class="text-body-medium on-surface-variant mb-2">{{ t("jskit.auth.login.confirmEmail.devLink") }}</p>
              <p class="email-confirmation-url text-body-small mb-3">{{ confirmationUrl }}</p>
              <v-btn
                class="text-none"
                variant="flat"
                color="primary"
                data-testid="auth-confirmation-dev-confirm"
                :loading="registrationConfirmPending"
                @click="confirmRegistrationFromLink"
              >
                {{ t("jskit.auth.login.confirmEmail.useDevLink") }}
              </v-btn>
            </div>

            <div v-if="canEnterConfirmationCode" class="email-confirmation-code d-flex align-start ga-2 mb-5">
              <v-text-field
                v-model="confirmationCode"
                data-testid="auth-confirmation-code"
                :label="t('jskit.auth.login.field.confirmationCode')"
                variant="outlined"
                density="comfortable"
                autocomplete="off"
                hide-details="auto"
              />
              <v-btn
                class="text-none mt-1"
                variant="tonal"
                color="primary"
                size="large"
                type="submit"
                data-testid="auth-confirmation-submit"
                :disabled="!confirmationCode.trim()"
                :loading="registrationConfirmPending"
              >
                {{ t("jskit.auth.login.confirmEmail.confirm") }}
              </v-btn>
            </div>

            <div class="switch-row d-flex align-center justify-space-between ga-3">
              <v-btn class="text-none" variant="tonal" color="primary" @click="goToMainScreen">
                {{ t("jskit.auth.login.confirmEmail.goToMainScreen") }}
              </v-btn>
              <v-btn
                v-if="canResendEmailConfirmation"
                class="text-none"
                variant="outlined"
                color="secondary"
                :loading="registerConfirmationResendPending"
                @click="resendRegisterConfirmationEmail"
              >
                {{ t("jskit.auth.login.confirmEmail.resend") }}
              </v-btn>
              <v-btn variant="text" color="secondary" @click="switchMode('login')">
                {{ t("jskit.auth.login.backToSignIn") }}
              </v-btn>
            </div>
          </template>

          <template v-else>
            <div
              v-if="showRememberedAccount"
              class="remembered-account d-flex align-center justify-space-between ga-3 mb-4"
            >
              <div class="remembered-copy flex-grow-1">
                <p class="remembered-title text-title-small">
                  {{ t("jskit.auth.login.rememberedAccount.welcomeBack", { name: rememberedAccountDisplayName }) }}
                </p>
                <p class="remembered-email text-body-small">{{ rememberedAccountMaskedEmail }}</p>
              </div>
              <v-btn variant="text" color="secondary" class="text-none" @click="switchAccount">
                {{ rememberedAccountSwitchLabel }}
              </v-btn>
            </div>

            <div
              v-if="isRegister && needsFirstAccountSetupCode"
              class="first-account-setup mb-4"
              data-testid="auth-first-account-setup"
            >
              <p class="text-body-medium mb-3">{{ t("jskit.auth.login.firstAccount.explain") }}</p>
              <v-text-field
                v-model="setupCode"
                :label="t('jskit.auth.login.field.setupCode')"
                variant="outlined"
                density="comfortable"
                autocomplete="off"
                spellcheck="false"
                hide-details="auto"
              />
            </div>

            <v-text-field
              v-if="!isLogin || canUsePasswordLogin"
              v-model="email"
              :label="t('jskit.auth.login.field.email')"
              variant="outlined"
              density="comfortable"
              type="email"
              autocomplete="email"
              :error-messages="emailErrorMessages"
              @blur="emailTouched = true"
              class="mb-3"
            />

            <v-text-field
              v-if="(isLogin && canUsePasswordLogin) || isRegister"
              v-model="password"
              :label="t('jskit.auth.login.field.password')"
              :type="showPassword ? 'text' : 'password'"
              variant="outlined"
              density="comfortable"
              :autocomplete="isRegister ? 'new-password' : 'current-password'"
              :error-messages="passwordErrorMessages"
              :append-inner-icon="showPassword ? '$visibilityOff' : '$visibility'"
              @click:append-inner="togglePasswordVisibility"
              @blur="passwordTouched = true"
              class="mb-3"
            />

            <v-text-field
              v-if="isRegister"
              v-model="confirmPassword"
              :label="t('jskit.auth.login.field.confirmPassword')"
              :type="showConfirmPassword ? 'text' : 'password'"
              variant="outlined"
              density="comfortable"
              autocomplete="new-password"
              :error-messages="confirmPasswordErrorMessages"
              :append-inner-icon="showConfirmPassword ? '$visibilityOff' : '$visibility'"
              @click:append-inner="toggleConfirmPasswordVisibility"
              @blur="confirmPasswordTouched = true"
              class="mb-3"
            />

            <v-text-field
              v-if="isOtp"
              v-model="otpCode"
              :label="t('jskit.auth.login.field.otpCode')"
              variant="outlined"
              density="comfortable"
              autocomplete="one-time-code"
              :error-messages="otpCodeErrorMessages"
              @blur="otpCodeTouched = true"
              class="mb-3"
            />

            <div v-if="isLogin && (canRequestPasswordRecovery || canUseOtp)" class="aux-links d-flex justify-end mb-4">
              <v-btn
                v-if="canRequestPasswordRecovery"
                variant="text"
                color="secondary"
                @click="switchMode('forgot')"
              >
                {{ t("jskit.auth.login.forgotPassword") }}
              </v-btn>
              <v-btn v-if="canUseOtp" variant="text" color="secondary" @click="switchMode('otp')">
                {{ t("jskit.auth.login.useOtp") }}
              </v-btn>
            </div>

            <v-checkbox
              v-if="(isLogin && canUsePasswordLogin) || isOtp"
              v-model="rememberAccountOnDevice"
              :label="t('jskit.auth.login.rememberedAccount.rememberDevice')"
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
                {{ t("jskit.auth.login.sendOtp") }}
              </v-btn>
            </div>

            <div v-if="canUseOAuth && (isLogin || isRegister)" class="oauth-actions d-grid ga-2 mb-4">
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
              v-if="!isLogin || canUsePasswordLogin"
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
              <span class="on-surface-variant">{{ t("jskit.auth.login.hasAccount") }}</span>
              <v-btn variant="text" color="secondary" @click="switchMode('login')">
                {{ t("jskit.auth.login.backToSignIn") }}
              </v-btn>
            </div>

            <div v-else-if="isForgot" class="switch-row mt-4 d-flex align-center justify-space-between ga-3">
              <span class="on-surface-variant">{{ t("jskit.auth.login.rememberedPassword") }}</span>
              <v-btn variant="text" color="secondary" @click="switchMode('login')">
                {{ t("jskit.auth.login.backToSignIn") }}
              </v-btn>
            </div>

            <div v-else-if="isOtp" class="switch-row mt-4 d-flex align-center justify-space-between ga-3">
              <span class="on-surface-variant">{{ t("jskit.auth.login.otherMethod") }}</span>
              <v-btn variant="text" color="secondary" @click="switchMode('login')">
                {{ t("jskit.auth.login.backToSignIn") }}
              </v-btn>
            </div>
          </template>
        </v-form>
      </v-card-text>
    </v-card>
  </AuthScreen>
</template>

<script setup>
import { useDisplay } from "vuetify";
import AuthScreen from "./AuthScreen.vue";
import { useLoginView } from "../runtime/useLoginView.js";
import { useJskitText } from "../i18n.js";

const { mobile: isMobileViewport } = useDisplay({ mobileBreakpoint: 960 });
const { t } = useJskitText();

const {
  authTitle,
  authSubtitle,
  isForgot,
  isOtp,
  isLogin,
  isRegister,
  isEmailConfirmationPending,
  canUsePasswordLogin,
  canRegister,
  canRequestPasswordRecovery,
  canUseOtp,
  canUseOAuth,
  canResendEmailConfirmation,
  canEnterConfirmationCode,
  needsFirstAccountSetupCode,
  setupCode,
  confirmationUrl,
  confirmationCode,
  registrationConfirmPending,
  confirmRegistrationFromLink,
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
  submitLabel,
  emailErrorMessages,
  passwordErrorMessages,
  confirmPasswordErrorMessages,
  otpCodeErrorMessages,
  canSubmit,
  submitAuth,
  requestOtpCode,
  resendRegisterConfirmationEmail,
  oauthProviderIcon,
  startOAuthSignIn,
  oauthProviderButtonLabel
} = useLoginView();

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value;
}

function toggleConfirmPasswordVisibility() {
  showConfirmPassword.value = !showConfirmPassword.value;
}
</script>

<style scoped>
.auth-card {
  width: min(520px, 100%);
}

/* On a phone the card is the screen below the brand row, if any. */
.auth-card--mobile {
  flex: 1 0 auto;
  width: 100%;
}

.auth-content {
  padding: 28px;
}

.auth-content--mobile {
  padding: calc(24px + var(--auth-screen-top-inset, 0px)) 20px calc(32px + env(safe-area-inset-bottom, 0px));
}

.auth-title {
  margin: 0 0 8px;
  color: rgb(var(--v-theme-on-surface));
}

.mode-switch {
  border-radius: 9999px;
  background-color: rgb(var(--v-theme-surface-container-highest));
}

.email-confirmation-state,
.remembered-account {
  border-radius: 12px;
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.email-confirmation-state {
  padding: 16px;
}

.first-account-setup {
  border-radius: 12px;
  background: rgb(var(--v-theme-warning-container));
  color: rgb(var(--v-theme-on-warning-container));
  padding: 16px;
}

.email-confirmation-dev-link {
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-highest));
  padding: 16px;
}

.email-confirmation-url {
  font-family: monospace;
  overflow-wrap: anywhere;
}

.remembered-account {
  padding: 12px 16px;
}

.remembered-copy {
  min-width: 0;
}

.remembered-title {
  margin: 0;
}

.remembered-email {
  margin: 2px 0 0;
}

.oauth-provider-button {
  justify-content: center;
}
</style>
