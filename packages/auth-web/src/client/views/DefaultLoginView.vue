<template>
  <AuthScreen class="login-screen" :class="{ 'login-screen--mobile': isMobileViewport }">
    <template v-if="$slots.brand" #brand="brand">
      <slot name="brand" v-bind="brand" />
    </template>
    <!-- A browser the shell found signed in is on its way to the page it asked for: it is shown no form. -->
    <v-card
      v-if="!redirectingSignedIn"
      class="auth-card"
      :class="{ 'auth-card--mobile': isMobileViewport }"
      variant="flat"
      :rounded="isMobileViewport ? false : undefined"
    >
      <v-card-text class="auth-content" :class="{ 'auth-content--mobile': isMobileViewport }">
        <div v-if="authTitle || authSubtitle" class="auth-header mb-5">
          <div>
            <h1 v-if="authTitle" class="auth-title" :class="text.title">{{ authTitle }}</h1>
            <p v-if="authSubtitle" class="on-surface-variant mb-0">{{ authSubtitle }}</p>
          </div>
        </div>

        <!-- Sign in and Register: a Material 3 segmented button, offered only when both are. -->
        <div
          v-if="!isForgot && !isOtp && !isEmailConfirmationPending && !showRememberedAccount && canRegister"
          class="mode-switch mb-5"
          role="radiogroup"
          :aria-label="t('jskit.auth.login.mode.label')"
          data-testid="auth-mode-switch"
        >
          <v-btn
            data-testid="auth-mode-sign-in"
            class="mode-switch__segment text-none"
            role="radio"
            :aria-checked="isLogin ? 'true' : 'false'"
            :active="isLogin"
            :prepend-icon="isLogin ? '$complete' : undefined"
            variant="text"
            rounded="0"
            @click="switchMode('login')"
          >
            {{ t("jskit.auth.login.mode.signIn") }}
          </v-btn>
          <v-btn
            data-testid="auth-mode-register"
            class="mode-switch__segment text-none"
            role="radio"
            :aria-checked="isRegister ? 'true' : 'false'"
            :active="isRegister"
            :prepend-icon="isRegister ? '$complete' : undefined"
            variant="text"
            rounded="0"
            @click="switchMode('register')"
          >
            {{ t("jskit.auth.login.mode.register") }}
          </v-btn>
        </div>

        <v-form @submit.prevent="submitAuth" novalidate>
          <template v-if="isEmailConfirmationPending">
            <div class="email-confirmation-state mb-5">
              <p class="email-confirmation-message mb-0" :class="text.body">
                {{ emailConfirmationMessage }}
              </p>
            </div>

            <!-- Confirming takes the password the registration was made with, so only its owner can confirm it. -->
            <v-text-field
              v-model="password"
              data-testid="auth-confirmation-password"
              :label="t('jskit.auth.login.field.registrationPassword')"
              :hint="t('jskit.auth.login.confirmEmail.passwordHint')"
              persistent-hint
              :type="showPassword ? 'text' : 'password'"
              variant="outlined"
              density="comfortable"
              autocomplete="current-password"
              :error-messages="passwordErrorMessages"
              :append-inner-icon="showPassword ? '$visibilityOff' : '$visibility'"
              @click:append-inner="togglePasswordVisibility"
              @blur="passwordTouched = true"
              class="mb-5"
            />

            <div v-if="confirmationLinkToken" class="email-confirmation-link mb-5">
              <UiButton
                class="text-none"
                emphasis="high"
                size="large"
                type="submit"
                data-testid="auth-confirmation-link-submit"
                :disabled="!password"
                :pending="registrationConfirmPending"
              >
                {{ t("jskit.auth.login.confirmEmail.confirm") }}
              </UiButton>
            </div>

            <div v-if="confirmationUrl" class="email-confirmation-dev-link mb-5" data-testid="auth-confirmation-dev-link">
              <p class="on-surface-variant mb-2" :class="text.body">{{ t("jskit.auth.login.confirmEmail.devLink") }}</p>
              <p class="email-confirmation-url mb-3" :class="text.caption">{{ confirmationUrl }}</p>
              <UiButton
                class="text-none"
                emphasis="high"
                data-testid="auth-confirmation-dev-confirm"
                :disabled="!password"
                :pending="registrationConfirmPending"
                @click="confirmRegistrationFromLink"
              >
                {{ t("jskit.auth.login.confirmEmail.useDevLink") }}
              </UiButton>
            </div>

            <div
              v-if="canEnterConfirmationCode && !confirmationLinkToken"
              class="email-confirmation-code d-flex align-start ga-2 mb-5"
            >
              <v-text-field
                v-model="confirmationCode"
                data-testid="auth-confirmation-code"
                :label="t('jskit.auth.login.field.confirmationCode')"
                variant="outlined"
                density="comfortable"
                autocomplete="off"
                hide-details="auto"
              />
              <UiButton
                class="text-none mt-1"
                emphasis="medium"
                size="large"
                type="submit"
                data-testid="auth-confirmation-submit"
                :disabled="!confirmationCode.trim() || !password"
                :pending="registrationConfirmPending"
              >
                {{ t("jskit.auth.login.confirmEmail.confirm") }}
              </UiButton>
            </div>

            <div class="switch-row d-flex flex-wrap align-center justify-space-between ga-3">
              <UiButton class="text-none" emphasis="medium" @click="goToMainScreen">
                {{ t("jskit.auth.login.confirmEmail.goToMainScreen") }}
              </UiButton>
              <UiButton
                v-if="canResendEmailConfirmation"
                class="text-none"
                emphasis="subtle"
                tone="neutral"
                :pending="registerConfirmationResendPending"
                @click="resendRegisterConfirmationEmail"
              >
                {{ t("jskit.auth.login.confirmEmail.resend") }}
              </UiButton>
              <UiButton emphasis="low" tone="neutral" @click="switchMode('login')">
                {{ t("jskit.auth.login.backToSignIn") }}
              </UiButton>
            </div>
          </template>

          <template v-else>
            <div
              v-if="showRememberedAccount"
              class="remembered-account d-flex align-center justify-space-between ga-3 mb-4"
            >
              <div class="remembered-copy flex-grow-1">
                <p class="remembered-title" :class="text.strong">
                  {{ t("jskit.auth.login.rememberedAccount.welcomeBack", { name: rememberedAccountDisplayName }) }}
                </p>
                <p class="remembered-email" :class="text.caption">{{ rememberedAccountMaskedEmail }}</p>
              </div>
              <UiButton emphasis="low" tone="neutral" class="text-none" @click="switchAccount">
                {{ rememberedAccountSwitchLabel }}
              </UiButton>
            </div>

            <div
              v-if="isRegister && needsFirstAccountSetupCode"
              class="first-account-setup mb-4"
              data-testid="auth-first-account-setup"
            >
              <p class="mb-3" :class="text.body">{{ t("jskit.auth.login.firstAccount.explain") }}</p>
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
            />

            <div v-if="isLogin && (canRequestPasswordRecovery || canUseOtp)" class="aux-links d-flex flex-wrap justify-end mb-4">
              <UiButton
                v-if="canRequestPasswordRecovery"
                emphasis="low"
                tone="neutral"
                @click="switchMode('forgot')"
              >
                {{ t("jskit.auth.login.forgotPassword") }}
              </UiButton>
              <UiButton v-if="canUseOtp" emphasis="low" tone="neutral" @click="switchMode('otp')">
                {{ t("jskit.auth.login.useOtp") }}
              </UiButton>
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
              <UiButton
                type="button"
                emphasis="medium"
                tone="neutral"
                :pending="otpRequestPending"
                @click="requestOtpCode"
              >
                {{ t("jskit.auth.login.sendOtp") }}
              </UiButton>
            </div>

            <!-- Password sign-in paused for this address: the ways forward this app offers besides waiting. -->
            <div
              v-if="isLogin && signInPausedMinutes > 0"
              class="sign-in-paused mb-4"
              role="status"
              data-testid="auth-sign-in-paused"
            >
              <p class="mb-2">{{ t("jskit.auth.login.signInPaused.wait", { count: signInPausedMinutes }) }}</p>
              <template v-if="canRequestPasswordRecovery || canRegister || canUseOAuth">
                <p class="mb-2">{{ t("jskit.auth.login.signInPaused.instead") }}</p>
                <div class="d-flex flex-wrap ga-2">
                  <UiButton v-if="canRequestPasswordRecovery" emphasis="medium" tone="neutral" @click="switchMode('forgot')">
                    {{ t("jskit.auth.login.signInPaused.resetPassword") }}
                  </UiButton>
                  <UiButton v-if="canRegister" emphasis="medium" tone="neutral" @click="switchMode('register')">
                    {{ t("jskit.auth.login.signInPaused.register") }}
                  </UiButton>
                </div>
                <p v-if="canUseOAuth" class="mt-2 mb-0">{{ t("jskit.auth.login.signInPaused.providers") }}</p>
              </template>
            </div>

            <!-- A provider sign-in that took too long: start it again, to the same page. -->
            <UiButton
              v-if="oauthRetryProvider && (isLogin || isRegister)"
              block
              emphasis="medium"
              class="text-none mb-4"
              data-testid="auth-oauth-retry"
              :disabled="loading"
              @click="startOAuthSignIn(oauthRetryProvider)"
            >
              {{ t("jskit.auth.login.oauth.tryAgain", { provider: oauthProviderName(oauthRetryProvider) }) }}
            </UiButton>

            <div v-if="canUseOAuth && (isLogin || isRegister)" class="oauth-actions d-grid ga-2 mb-4">
              <UiButton
                v-for="provider in oauthProviders"
                :key="provider.id"
                block
                emphasis="subtle"
                tone="neutral"
                :disabled="loading"
                :icon="oauthProviderIcon(provider)"
                class="text-none oauth-provider-button"
                @click="startOAuthSignIn(provider.id)"
              >
                {{ oauthProviderButtonLabel(provider) }}
              </UiButton>
            </div>
            <UiButton
              v-if="!isLogin || canUsePasswordLogin"
              data-testid="auth-submit"
              block
              emphasis="high"
              size="large"
              :pending="loading"
              :disabled="!canSubmit"
              type="submit"
            >
              {{ submitLabel }}
            </UiButton>

            <div v-if="isForgot" class="switch-row mt-4 d-flex flex-wrap align-center justify-space-between ga-3">
              <span class="on-surface-variant">{{ t("jskit.auth.login.rememberedPassword") }}</span>
              <UiButton emphasis="low" tone="neutral" @click="switchMode('login')">
                {{ t("jskit.auth.login.backToSignIn") }}
              </UiButton>
            </div>

            <div v-else-if="isOtp" class="switch-row mt-4 d-flex flex-wrap align-center justify-space-between ga-3">
              <span class="on-surface-variant">{{ t("jskit.auth.login.otherMethod") }}</span>
              <UiButton emphasis="low" tone="neutral" @click="switchMode('login')">
                {{ t("jskit.auth.login.backToSignIn") }}
              </UiButton>
            </div>
          </template>
        </v-form>
      </v-card-text>
    </v-card>
  </AuthScreen>
</template>

<script setup>
import { useDisplay } from "vuetify";
import { useShellUi } from "@jskit-ai/shell-web/client/ui";
import AuthScreen from "./AuthScreen.vue";
import { useLoginView } from "../composables/useLoginView.js";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  // Where a sign-in lands when the address names no returnTo, or one refused as foreign or as a sign-in loop.
  fallbackReturnTo: { type: String, default: "/" }
});

const { mobile: isMobileViewport } = useDisplay({ mobileBreakpoint: 960 });
const { t } = useJskitText();
// The application's button and type classes, or Material 3's (shell-web's UI kit).
const { Button: UiButton, text } = useShellUi();

const {
  authTitle,
  authSubtitle,
  isForgot,
  isOtp,
  isLogin,
  isRegister,
  isEmailConfirmationPending,
  redirectingSignedIn,
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
  confirmationLinkToken,
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
  oauthProviderButtonLabel,
  signInPausedMinutes,
  oauthRetryProvider
} = useLoginView({ fallbackReturnTo: props.fallbackReturnTo });

function oauthProviderName(providerId) {
  return oauthProviders.value.find((provider) => provider.id === providerId)?.label || providerId;
}

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

/* Material 3's segmented button: one outline, equal segments, the selected one in secondary-container with a check. */
/* Two equal grid columns: the divider sits inside the second segment, so it can't make the segments differ. */
.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 40px;
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 9999px;
}

.mode-switch__segment.v-btn {
  min-width: 0;
  height: 100%;
  color: rgb(var(--v-theme-on-surface));
}

.mode-switch__segment + .mode-switch__segment {
  border-inline-start: 1px solid rgb(var(--v-theme-outline));
}

.mode-switch__segment.v-btn--active {
  background-color: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

/* The fill marks the selection; the state layer stays for hover, focus and press. */
.mode-switch__segment.v-btn--active > .v-btn__overlay {
  opacity: 0;
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

.sign-in-paused {
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
  padding: 16px;
}
</style>
