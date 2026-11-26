<script setup>
import { useId } from "vue";
import { useJskitText } from "@jskit-ai/kernel/client";
import { useLoginView } from "@jskit-ai/auth-web/client/composables/useLoginView";
import AppBrand from "@/components/AppBrand.vue";

// The app's sign-in screen in its own design system: plain HTML and the app's CSS (the tokens of src/theme/), no
// Vuetify. Every behavior comes from useLoginView(), the composable JSKIT's DefaultLoginView renders in Material 3:
// the modes, the provider buttons, the remembered account, invitations, the returnTo landing and the session checks.
// The words are JSKIT's messages, so the app's translations apply.
const { t } = useJskitText();
const id = useId();
const {
  authTitle,
  authSubtitle,
  isLogin,
  isRegister,
  isForgot,
  isOtp,
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
  emailErrorMessages,
  emailTouched,
  password,
  passwordErrorMessages,
  passwordTouched,
  confirmPassword,
  confirmPasswordErrorMessages,
  confirmPasswordTouched,
  otpCode,
  otpCodeErrorMessages,
  otpCodeTouched,
  rememberAccountOnDevice,
  otpRequestPending,
  registerConfirmationResendPending,
  requestOtpCode,
  resendRegisterConfirmationEmail,
  oauthProviders,
  startOAuthSignIn,
  oauthProviderButtonLabel,
  oauthRetryProvider,
  signInPausedMinutes,
  errorMessage,
  infoMessage,
  loading,
  canSubmit,
  submitLabel,
  submitAuth
} = useLoginView();

function providerName(providerId) {
  return oauthProviders.value.find((provider) => provider.id === providerId)?.label || providerId;
}
</script>

<template>
  <main class="auth-page">
    <!-- A browser already signed in is on its way to the page it asked for: it is shown no form. -->
    <section v-if="!redirectingSignedIn" class="auth-panel" :aria-labelledby="`${id}-title`">
      <AppBrand />
      <h1 :id="`${id}-title`" class="auth-title">{{ authTitle }}</h1>
      <p v-if="authSubtitle" class="auth-muted">{{ authSubtitle }}</p>

      <div
        v-if="canRegister && (isLogin || isRegister) && !showRememberedAccount"
        class="auth-tabs"
        role="radiogroup"
        :aria-label="t('jskit.auth.login.mode.label')"
      >
        <button type="button" role="radio" :aria-checked="String(isLogin)" @click="switchMode('login')">
          {{ t("jskit.auth.login.mode.signIn") }}
        </button>
        <button type="button" role="radio" :aria-checked="String(isRegister)" @click="switchMode('register')">
          {{ t("jskit.auth.login.mode.register") }}
        </button>
      </div>

      <!-- The refusal stays beside the form until the next attempt; the shell's banner hears it too. -->
      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>
      <p v-else-if="infoMessage" class="auth-message" role="status">{{ infoMessage }}</p>

      <form class="auth-form" novalidate @submit.prevent="submitAuth">
        <template v-if="isEmailConfirmationPending">
          <p class="auth-note">{{ emailConfirmationMessage }}</p>
          <div class="auth-field">
            <label :for="`${id}-registration-password`">{{ t("jskit.auth.login.field.registrationPassword") }}</label>
            <input
              :id="`${id}-registration-password`"
              v-model="password"
              type="password"
              autocomplete="current-password"
              :aria-invalid="passwordErrorMessages.length > 0"
              :aria-describedby="`${id}-registration-password-hint`"
              @blur="passwordTouched = true"
            >
            <p :id="`${id}-registration-password-hint`" class="auth-field__line">
              {{ passwordErrorMessages[0] || t("jskit.auth.login.confirmEmail.passwordHint") }}
            </p>
          </div>
          <div v-if="canEnterConfirmationCode && !confirmationLinkToken" class="auth-field">
            <label :for="`${id}-confirmation-code`">{{ t("jskit.auth.login.field.confirmationCode") }}</label>
            <input :id="`${id}-confirmation-code`" v-model="confirmationCode" autocomplete="off">
          </div>
          <button
            v-if="confirmationLinkToken || canEnterConfirmationCode"
            class="auth-button auth-button--primary"
            type="submit"
            :disabled="!password || registrationConfirmPending || (!confirmationLinkToken && !confirmationCode.trim())"
          >
            {{ t("jskit.auth.login.confirmEmail.confirm") }}
          </button>
          <div v-if="confirmationUrl" class="auth-note">
            <p>{{ t("jskit.auth.login.confirmEmail.devLink") }}</p>
            <p class="auth-code">{{ confirmationUrl }}</p>
            <button class="auth-button" type="button" :disabled="!password || registrationConfirmPending" @click="confirmRegistrationFromLink">
              {{ t("jskit.auth.login.confirmEmail.useDevLink") }}
            </button>
          </div>
          <div class="auth-row">
            <button class="auth-button" type="button" @click="goToMainScreen">{{ t("jskit.auth.login.confirmEmail.goToMainScreen") }}</button>
            <button
              v-if="canResendEmailConfirmation"
              class="auth-button"
              type="button"
              :disabled="registerConfirmationResendPending"
              @click="resendRegisterConfirmationEmail"
            >
              {{ t("jskit.auth.login.confirmEmail.resend") }}
            </button>
            <button class="auth-link" type="button" @click="switchMode('login')">{{ t("jskit.auth.login.backToSignIn") }}</button>
          </div>
        </template>

        <template v-else>
          <div v-if="showRememberedAccount" class="auth-note auth-row">
            <div>
              <p class="auth-strong">{{ t("jskit.auth.login.rememberedAccount.welcomeBack", { name: rememberedAccountDisplayName }) }}</p>
              <p class="auth-muted">{{ rememberedAccountMaskedEmail }}</p>
            </div>
            <button class="auth-link" type="button" @click="switchAccount">{{ rememberedAccountSwitchLabel }}</button>
          </div>

          <div v-if="isRegister && needsFirstAccountSetupCode" class="auth-field">
            <p class="auth-note">{{ t("jskit.auth.login.firstAccount.explain") }}</p>
            <label :for="`${id}-setup-code`">{{ t("jskit.auth.login.field.setupCode") }}</label>
            <input :id="`${id}-setup-code`" v-model="setupCode" autocomplete="off" spellcheck="false">
          </div>

          <div v-if="!isLogin || canUsePasswordLogin" class="auth-field">
            <label :for="`${id}-email`">{{ t("jskit.auth.login.field.email") }}</label>
            <input
              :id="`${id}-email`"
              v-model="email"
              type="email"
              autocomplete="email"
              :aria-invalid="emailErrorMessages.length > 0"
              :aria-describedby="`${id}-email-error`"
              @blur="emailTouched = true"
            >
            <!-- Each field keeps its error line, so an error shown on blur moves nothing below it. -->
            <p :id="`${id}-email-error`" class="auth-field__line auth-field__line--error">{{ emailErrorMessages[0] }}</p>
          </div>

          <div v-if="(isLogin && canUsePasswordLogin) || isRegister" class="auth-field">
            <label :for="`${id}-password`">{{ t("jskit.auth.login.field.password") }}</label>
            <input
              :id="`${id}-password`"
              v-model="password"
              type="password"
              :autocomplete="isRegister ? 'new-password' : 'current-password'"
              :aria-invalid="passwordErrorMessages.length > 0"
              :aria-describedby="`${id}-password-error`"
              @blur="passwordTouched = true"
            >
            <p :id="`${id}-password-error`" class="auth-field__line auth-field__line--error">{{ passwordErrorMessages[0] }}</p>
          </div>

          <div v-if="isRegister" class="auth-field">
            <label :for="`${id}-confirm-password`">{{ t("jskit.auth.login.field.confirmPassword") }}</label>
            <input
              :id="`${id}-confirm-password`"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              :aria-invalid="confirmPasswordErrorMessages.length > 0"
              :aria-describedby="`${id}-confirm-password-error`"
              @blur="confirmPasswordTouched = true"
            >
            <p :id="`${id}-confirm-password-error`" class="auth-field__line auth-field__line--error">{{ confirmPasswordErrorMessages[0] }}</p>
          </div>

          <div v-if="isOtp" class="auth-field">
            <label :for="`${id}-otp`">{{ t("jskit.auth.login.field.otpCode") }}</label>
            <input
              :id="`${id}-otp`"
              v-model="otpCode"
              autocomplete="one-time-code"
              :aria-invalid="otpCodeErrorMessages.length > 0"
              :aria-describedby="`${id}-otp-error`"
              @blur="otpCodeTouched = true"
            >
            <p :id="`${id}-otp-error`" class="auth-field__line auth-field__line--error">{{ otpCodeErrorMessages[0] }}</p>
            <button class="auth-button" type="button" :disabled="otpRequestPending" @click="requestOtpCode">
              {{ t("jskit.auth.login.sendOtp") }}
            </button>
          </div>

          <div v-if="isLogin && (canRequestPasswordRecovery || canUseOtp)" class="auth-row auth-row--end">
            <button v-if="canRequestPasswordRecovery" class="auth-link" type="button" @click="switchMode('forgot')">
              {{ t("jskit.auth.login.forgotPassword") }}
            </button>
            <button v-if="canUseOtp" class="auth-link" type="button" @click="switchMode('otp')">{{ t("jskit.auth.login.useOtp") }}</button>
          </div>

          <label v-if="(isLogin && canUsePasswordLogin) || isOtp" class="auth-check">
            <input v-model="rememberAccountOnDevice" type="checkbox">
            {{ t("jskit.auth.login.rememberedAccount.rememberDevice") }}
          </label>

          <!-- Password sign-in paused for this address: the ways forward this app offers besides waiting. -->
          <div v-if="isLogin && signInPausedMinutes > 0" class="auth-note" role="status">
            <p>{{ t("jskit.auth.login.signInPaused.wait", { count: signInPausedMinutes }) }}</p>
            <div v-if="canRequestPasswordRecovery || canRegister" class="auth-row">
              <button v-if="canRequestPasswordRecovery" class="auth-button" type="button" @click="switchMode('forgot')">
                {{ t("jskit.auth.login.signInPaused.resetPassword") }}
              </button>
              <button v-if="canRegister" class="auth-button" type="button" @click="switchMode('register')">
                {{ t("jskit.auth.login.signInPaused.register") }}
              </button>
            </div>
          </div>

          <button
            v-if="!isLogin || canUsePasswordLogin"
            class="auth-button auth-button--primary"
            type="submit"
            :disabled="!canSubmit"
          >
            {{ submitLabel }}
          </button>

          <div v-if="canUseOAuth && (isLogin || isRegister)" class="auth-providers">
            <!-- A provider sign-in that took too long: start it again, to the same page. -->
            <button v-if="oauthRetryProvider" class="auth-button" type="button" :disabled="loading" @click="startOAuthSignIn(oauthRetryProvider)">
              {{ t("jskit.auth.login.oauth.tryAgain", { provider: providerName(oauthRetryProvider) }) }}
            </button>
            <button
              v-for="provider in oauthProviders"
              :key="provider.id"
              class="auth-button"
              type="button"
              :disabled="loading"
              @click="startOAuthSignIn(provider.id)"
            >
              {{ oauthProviderButtonLabel(provider) }}
            </button>
          </div>

          <div v-if="isForgot || isOtp" class="auth-row">
            <span class="auth-muted">{{ isForgot ? t("jskit.auth.login.rememberedPassword") : t("jskit.auth.login.otherMethod") }}</span>
            <button class="auth-link" type="button" @click="switchMode('login')">{{ t("jskit.auth.login.backToSignIn") }}</button>
          </div>
        </template>
      </form>
    </section>
  </main>
</template>

<style scoped>
/* Every colour, radius and font is one of the app's design tokens (src/theme/tokens.css). */
.auth-page {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 24px 16px;
  background: var(--ds-page);
  color: var(--ds-text);
  font-family: var(--ds-font);
}

.auth-panel {
  display: grid;
  gap: 16px;
  width: min(420px, 100%);
  padding: 32px;
  border-radius: var(--ds-radius-large);
  background: var(--ds-panel);
}

.auth-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
}

.auth-muted,
.auth-note p,
.auth-panel p {
  margin: 0;
}

.auth-muted {
  color: var(--ds-text-muted);
}

.auth-strong {
  font-weight: 600;
}

.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  border-radius: var(--ds-radius);
  background: var(--ds-page);
}

.auth-tabs button {
  padding: 8px;
  border: 0;
  border-radius: var(--ds-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.auth-tabs button[aria-checked="true"] {
  background: var(--ds-panel);
  font-weight: 600;
}

.auth-form {
  display: grid;
  gap: 12px;
}

.auth-field {
  display: grid;
  gap: 4px;
}

.auth-field label {
  font-weight: 600;
}

.auth-field input {
  padding: 10px 12px;
  border: 1px solid var(--ds-line);
  border-radius: var(--ds-radius);
  background: var(--ds-panel);
  color: inherit;
  font: inherit;
}

.auth-field input:focus-visible,
.auth-button:focus-visible,
.auth-link:focus-visible,
.auth-tabs button:focus-visible {
  outline: 2px solid var(--ds-accent);
  outline-offset: 2px;
}

.auth-field input[aria-invalid="true"] {
  border-color: var(--ds-danger);
}

.auth-field__line {
  min-height: 1.25em;
  margin: 0;
  color: var(--ds-text-muted);
  font-size: 0.875rem;
}

.auth-field__line--error {
  color: var(--ds-danger);
}

.auth-button {
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--ds-line);
  border-radius: var(--ds-radius);
  background: var(--ds-panel);
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.auth-button--primary {
  border-color: var(--ds-accent);
  background: var(--ds-accent);
  color: var(--ds-on-accent);
}

.auth-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.auth-link {
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--ds-accent);
  font: inherit;
  cursor: pointer;
}

.auth-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.auth-row--end {
  justify-content: flex-end;
}

.auth-providers {
  display: grid;
  gap: 8px;
}

.auth-check {
  display: flex;
  gap: 8px;
  align-items: center;
}

.auth-note,
.auth-message {
  padding: 12px 16px;
  border-radius: var(--ds-radius);
  background: var(--ds-page);
}

.auth-message--error {
  background: var(--ds-danger-soft);
  color: var(--ds-danger);
}

.auth-code {
  font-family: monospace;
  overflow-wrap: anywhere;
}
</style>
