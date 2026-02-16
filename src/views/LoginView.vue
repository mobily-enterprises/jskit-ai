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

          <div v-if="!isForgot" class="mode-switch mb-5">
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
              v-if="!showRememberedAccount"
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
              v-if="!isForgot"
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

            <div v-if="isLogin" class="aux-links mb-4">
              <v-btn variant="text" color="secondary" @click="switchMode('forgot')">Forgot password?</v-btn>
            </div>

            <v-checkbox
              v-if="isLogin"
              v-model="rememberAccountOnDevice"
              label="Remember this account on this device"
              density="compact"
              hide-details
              class="mb-4"
            />

            <div v-if="isLogin" class="oauth-actions mb-4">
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
          </v-form>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import {
  AUTH_OAUTH_DEFAULT_PROVIDER,
  AUTH_OAUTH_PROVIDER_METADATA,
  AUTH_OAUTH_PROVIDERS,
  normalizeOAuthProvider
} from "../../shared/auth/oauthProviders.js";
import { validators } from "../../shared/auth/validators.js";
import { normalizeEmail } from "../../shared/auth/utils.js";

const REMEMBERED_ACCOUNT_STORAGE_KEY = "auth.rememberedAccount";
const PENDING_OAUTH_PROVIDER_STORAGE_KEY = "auth.oauth.pendingProvider";

const navigate = useNavigate();
const authStore = useAuthStore();

const mode = ref("login");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const emailTouched = ref(false);
const passwordTouched = ref(false);
const confirmPasswordTouched = ref(false);
const submitAttempted = ref(false);
const errorMessage = ref("");
const infoMessage = ref("");
const rememberAccountOnDevice = ref(true);
const rememberedAccount = ref(null);
const useRememberedAccount = ref(false);
const oauthCallbackInFlight = ref(false);

const isLogin = computed(() => mode.value === "login");
const isRegister = computed(() => mode.value === "register");
const isForgot = computed(() => mode.value === "forgot");
const showRememberedAccount = computed(() => isLogin.value && useRememberedAccount.value && Boolean(rememberedAccount.value));
const rememberedAccountDisplayName = computed(() => String(rememberedAccount.value?.displayName || "your account"));
const rememberedAccountMaskedEmail = computed(() => String(rememberedAccount.value?.maskedEmail || ""));
const rememberedAccountSwitchLabel = computed(() => {
  const shortName = String(rememberedAccount.value?.displayName || "").trim();
  return shortName ? `Not ${shortName}?` : "Use another account";
});
const oauthProviders = AUTH_OAUTH_PROVIDERS.map((providerId) => AUTH_OAUTH_PROVIDER_METADATA[providerId]).filter(Boolean);

const registerMutation = useMutation({
  mutationFn: (payload) => api.register(payload)
});

const loginMutation = useMutation({
  mutationFn: (payload) => api.login(payload)
});

const forgotPasswordMutation = useMutation({
  mutationFn: (payload) => api.requestPasswordReset(payload)
});

const loading = computed(
  () =>
    registerMutation.isPending.value ||
    loginMutation.isPending.value ||
    forgotPasswordMutation.isPending.value ||
    oauthCallbackInFlight.value
);

const authTitle = computed(() => {
  if (isRegister.value) {
    return "Register to continue";
  }
  if (isForgot.value) {
    return "Reset your password";
  }
  return "Sign in";
});

const authSubtitle = computed(() => {
  if (isRegister.value) {
    return "Create a new account to access calculations.";
  }
  if (isForgot.value) {
    return "Enter your email and we will send you a secure password reset link.";
  }
  return "";
});

const submitLabel = computed(() => {
  if (isRegister.value) {
    return "Create account";
  }
  if (isForgot.value) {
    return "Send reset link";
  }
  return "Sign in";
});

function hasRecoveryLinkPayload() {
  if (typeof window === "undefined") {
    return false;
  }

  const search = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const type = String(search.get("type") || hash.get("type") || "")
    .trim()
    .toLowerCase();

  return type === "recovery";
}

function redirectRecoveryLinkToResetPage() {
  if (!hasRecoveryLinkPayload()) {
    return false;
  }

  if (typeof window !== "undefined") {
    window.location.replace(`/reset-password${window.location.search || ""}${window.location.hash || ""}`);
  }

  return true;
}

function resetValidationState() {
  emailTouched.value = false;
  passwordTouched.value = false;
  confirmPasswordTouched.value = false;
  submitAttempted.value = false;
}

function isLocalStorageAvailable() {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  try {
    const key = "__auth_hint_probe__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function isSessionStorageAvailable() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return false;
  }

  try {
    const key = "__auth_oauth_probe__";
    window.sessionStorage.setItem(key, "1");
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function maskEmail(emailAddress) {
  const normalized = normalizeEmail(emailAddress);
  const separatorIndex = normalized.indexOf("@");
  if (separatorIndex <= 0) {
    return normalized;
  }

  const localPart = normalized.slice(0, separatorIndex);
  const domainPart = normalized.slice(separatorIndex + 1);
  const visiblePrefix = localPart.slice(0, 1);
  return `${visiblePrefix}***@${domainPart}`;
}

function createRememberedAccountHint({ email: accountEmail, displayName, lastUsedAt }) {
  const normalizedEmail = normalizeEmail(accountEmail);
  if (!normalizedEmail) {
    return null;
  }

  const normalizedDisplayName = String(displayName || "").trim() || normalizedEmail.split("@")[0] || "User";
  const normalizedLastUsedAt = String(lastUsedAt || new Date().toISOString());

  return {
    email: normalizedEmail,
    displayName: normalizedDisplayName,
    maskedEmail: maskEmail(normalizedEmail),
    lastUsedAt: normalizedLastUsedAt
  };
}

function readRememberedAccountHint() {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return createRememberedAccountHint(parsed);
  } catch {
    return null;
  }
}

function writeRememberedAccountHint(hint) {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(
      REMEMBERED_ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        email: hint.email,
        displayName: hint.displayName,
        lastUsedAt: hint.lastUsedAt
      })
    );
  } catch {
    // best effort only
  }
}

function clearRememberedAccountHint() {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.removeItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
  } catch {
    // best effort only
  }
}

function readPendingOAuthProvider() {
  if (!isSessionStorageAvailable()) {
    return null;
  }

  try {
    const value = window.sessionStorage.getItem(PENDING_OAUTH_PROVIDER_STORAGE_KEY);
    return normalizeOAuthProvider(value, { fallback: null });
  } catch {
    return null;
  }
}

function writePendingOAuthProvider(provider) {
  if (!isSessionStorageAvailable()) {
    return;
  }

  try {
    window.sessionStorage.setItem(PENDING_OAUTH_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // best effort only
  }
}

function clearPendingOAuthProvider() {
  if (!isSessionStorageAvailable()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(PENDING_OAUTH_PROVIDER_STORAGE_KEY);
  } catch {
    // best effort only
  }
}

function applyRememberedAccountHint(hint) {
  if (!hint) {
    rememberedAccount.value = null;
    useRememberedAccount.value = false;
    return;
  }

  rememberedAccount.value = hint;
  useRememberedAccount.value = true;
  rememberAccountOnDevice.value = true;
  email.value = hint.email;
}

function switchAccount() {
  clearRememberedAccountHint();
  rememberedAccount.value = null;
  useRememberedAccount.value = false;
  email.value = "";
  password.value = "";
  confirmPassword.value = "";
  errorMessage.value = "";
  infoMessage.value = "";
  resetValidationState();
}

function switchMode(nextMode) {
  if (nextMode === mode.value) {
    return;
  }

  mode.value = nextMode;
  password.value = "";
  confirmPassword.value = "";
  showPassword.value = false;
  showConfirmPassword.value = false;
  errorMessage.value = "";
  infoMessage.value = "";
  resetValidationState();

  if (nextMode !== "login") {
    useRememberedAccount.value = false;
    return;
  }

  if (rememberedAccount.value) {
    useRememberedAccount.value = true;
    email.value = rememberedAccount.value.email;
  }
}

function oauthProviderButtonLabel(provider) {
  const providerLabel = String(provider?.label || "OAuth provider");
  if (showRememberedAccount.value) {
    const displayName = rememberedAccountDisplayName.value;
    return `Continue with ${providerLabel} as ${displayName}`;
  }

  return `Continue with ${providerLabel}`;
}

function oauthProviderIcon(provider) {
  if (provider?.id === "google") {
    return "oauthGoogle";
  }

  return undefined;
}

function readOAuthCallbackPayloadFromLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  const search = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const code = String(search.get("code") || hash.get("code") || "").trim();
  const accessToken = String(search.get("access_token") || hash.get("access_token") || "").trim();
  const refreshToken = String(search.get("refresh_token") || hash.get("refresh_token") || "").trim();
  const errorCode = String(search.get("error") || hash.get("error") || "").trim();
  const errorDescription = String(search.get("error_description") || hash.get("error_description") || "").trim();
  const hasTokenPair = Boolean(accessToken && refreshToken);

  if (!code && !errorCode && !hasTokenPair) {
    return null;
  }

  const providerFromQuery = normalizeOAuthProvider(search.get("oauthProvider"), { fallback: null });
  const providerFromStorage = readPendingOAuthProvider();
  const provider = normalizeOAuthProvider(providerFromQuery || providerFromStorage || AUTH_OAUTH_DEFAULT_PROVIDER, {
    fallback: AUTH_OAUTH_DEFAULT_PROVIDER
  });

  const payload = {
    provider
  };

  if (code) {
    payload.code = code;
  }
  if (accessToken) {
    payload.accessToken = accessToken;
  }
  if (refreshToken) {
    payload.refreshToken = refreshToken;
  }
  if (errorCode) {
    payload.error = errorCode;
  }
  if (errorDescription) {
    payload.errorDescription = errorDescription;
  }

  return payload;
}

function stripOAuthCallbackParamsFromLocation() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.searchParams.delete("state");
  url.searchParams.delete("oauthProvider");
  url.searchParams.delete("access_token");
  url.searchParams.delete("refresh_token");
  url.searchParams.delete("provider_token");
  url.searchParams.delete("expires_at");
  url.searchParams.delete("expires_in");
  url.searchParams.delete("token_type");

  const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
  hash.delete("code");
  hash.delete("error");
  hash.delete("error_description");
  hash.delete("state");
  hash.delete("access_token");
  hash.delete("refresh_token");
  hash.delete("provider_token");
  hash.delete("expires_at");
  hash.delete("expires_in");
  hash.delete("token_type");
  hash.delete("type");
  hash.delete("sb");
  const nextHash = hash.toString();
  url.hash = nextHash ? `#${nextHash}` : "";

  const nextPath = `${url.pathname}${url.search || ""}${url.hash || ""}`;
  window.history.replaceState({}, "", nextPath || "/login");
}

async function startOAuthSignIn(providerId) {
  const provider = normalizeOAuthProvider(providerId, { fallback: null });
  if (!provider) {
    errorMessage.value = "OAuth provider is not supported.";
    return;
  }

  errorMessage.value = "";
  infoMessage.value = "";
  writePendingOAuthProvider(provider);

  if (typeof window !== "undefined") {
    window.location.assign(api.oauthStartUrl(provider));
  }
}

async function handleOAuthCallbackIfPresent() {
  const callbackPayload = readOAuthCallbackPayloadFromLocation();
  if (!callbackPayload) {
    return;
  }

  oauthCallbackInFlight.value = true;
  errorMessage.value = "";
  infoMessage.value = "";

  try {
    const response = await api.oauthComplete(callbackPayload);
    const session = await authStore.refreshSession();
    if (!session?.authenticated) {
      throw new Error("OAuth login succeeded but the session is not active yet. Please retry.");
    }

    const rememberedHint = createRememberedAccountHint({
      email: response?.email || "",
      displayName: response?.username || session?.username || "User",
      lastUsedAt: new Date().toISOString()
    });
    if (rememberAccountOnDevice.value && rememberedHint) {
      writeRememberedAccountHint(rememberedHint);
      applyRememberedAccountHint(rememberedHint);
    } else {
      clearRememberedAccountHint();
      rememberedAccount.value = null;
      useRememberedAccount.value = false;
    }

    stripOAuthCallbackParamsFromLocation();
    await navigate({ to: "/", replace: true });
  } catch (error) {
    errorMessage.value = toErrorMessage(error, "Unable to complete OAuth sign-in.");
    stripOAuthCallbackParamsFromLocation();
  } finally {
    clearPendingOAuthProvider();
    oauthCallbackInFlight.value = false;
  }
}

function toErrorMessage(error, fallback) {
  if (error?.fieldErrors && typeof error.fieldErrors === "object") {
    const details = Object.values(error.fieldErrors).filter(Boolean);
    if (details.length > 0) {
      return details.join(" ");
    }
  }

  return String(error?.message || fallback);
}

const emailError = computed(() => {
  return validators.email(email.value);
});

const passwordError = computed(() => {
  if (isForgot.value) {
    return "";
  }

  if (isRegister.value) {
    return validators.registerPassword(password.value);
  }

  return validators.loginPassword(password.value);
});

const confirmPasswordError = computed(() => {
  if (!isRegister.value) {
    return "";
  }

  return validators.confirmPassword({
    password: password.value,
    confirmPassword: confirmPassword.value
  });
});

const emailErrorMessages = computed(() => {
  if (!submitAttempted.value && !emailTouched.value) {
    return [];
  }
  return emailError.value ? [emailError.value] : [];
});

const passwordErrorMessages = computed(() => {
  if (isForgot.value || (!submitAttempted.value && !passwordTouched.value)) {
    return [];
  }
  return passwordError.value ? [passwordError.value] : [];
});

const confirmPasswordErrorMessages = computed(() => {
  if (!isRegister.value || (!submitAttempted.value && !confirmPasswordTouched.value)) {
    return [];
  }
  return confirmPasswordError.value ? [confirmPasswordError.value] : [];
});

const canSubmit = computed(() => {
  if (loading.value) {
    return false;
  }

  if (emailError.value) {
    return false;
  }

  if (!isForgot.value && passwordError.value) {
    return false;
  }

  if (isRegister.value && confirmPasswordError.value) {
    return false;
  }

  return true;
});

async function submitAuth() {
  submitAttempted.value = true;
  errorMessage.value = "";
  infoMessage.value = "";

  const cleanEmail = normalizeEmail(email.value);
  if (!canSubmit.value) {
    return;
  }

  try {
    if (isForgot.value) {
      const response = await forgotPasswordMutation.mutateAsync({
        email: cleanEmail
      });
      switchMode("login");
      email.value = cleanEmail;
      infoMessage.value = String(
        response?.message || "If an account exists for that email, a password reset link has been sent."
      );
      return;
    }

    if (isRegister.value) {
      const registerResponse = await registerMutation.mutateAsync({ email: cleanEmail, password: password.value });
      if (registerResponse.requiresEmailConfirmation) {
        switchMode("login");
        email.value = cleanEmail;
        infoMessage.value = "Registration accepted. Confirm your email, then sign in.";
        return;
      }
    } else {
      await loginMutation.mutateAsync({ email: cleanEmail, password: password.value });
    }

    const session = await authStore.refreshSession();
    if (!session?.authenticated) {
      throw new Error("Login succeeded but the session is not active yet. Please retry.");
    }

    const rememberedHint = createRememberedAccountHint({
      email: cleanEmail,
      displayName: session?.username || cleanEmail.split("@")[0] || "User",
      lastUsedAt: new Date().toISOString()
    });
    if (rememberAccountOnDevice.value && rememberedHint) {
      writeRememberedAccountHint(rememberedHint);
      applyRememberedAccountHint(rememberedHint);
    } else {
      clearRememberedAccountHint();
      rememberedAccount.value = null;
      useRememberedAccount.value = false;
    }

    await navigate({ to: "/", replace: true });
  } catch (error) {
    errorMessage.value = toErrorMessage(error, "Unable to complete authentication.");
  }
}

onMounted(async () => {
  if (redirectRecoveryLinkToResetPage()) {
    return;
  }

  applyRememberedAccountHint(readRememberedAccountHint());
  await handleOAuthCallbackIfPresent();
});
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
