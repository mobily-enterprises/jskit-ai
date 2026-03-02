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

          <div v-if="!isForgot && !isOtp" class="mode-switch d-flex ga-2 pa-1 mb-5">
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
              :append-inner-icon="showPassword ? '$eyeOff' : '$eye'"
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
              :append-inner-icon="showConfirmPassword ? '$eyeOff' : '$eye'"
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

            <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
              {{ errorMessage }}
            </v-alert>

            <v-alert v-if="infoMessage" type="info" variant="tonal" class="mb-4">
              {{ infoMessage }}
            </v-alert>

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
          </v-form>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { mdiGoogle } from "@mdi/js";
import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/access-core/server/oauthCallbackParams";
import { authHttpRequest } from "../runtime/authHttpClient.js";

const mode = ref("login");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const otpCode = ref("");
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const emailTouched = ref(false);
const passwordTouched = ref(false);
const confirmPasswordTouched = ref(false);
const otpCodeTouched = ref(false);
const submitAttempted = ref(false);
const rememberAccountOnDevice = ref(true);
const oauthProviders = ref([]);
const oauthDefaultProvider = ref("");
const loading = ref(false);
const otpRequestPending = ref(false);
const errorMessage = ref("");
const infoMessage = ref("");

const isLogin = computed(() => mode.value === "login");
const isRegister = computed(() => mode.value === "register");
const isForgot = computed(() => mode.value === "forgot");
const isOtp = computed(() => mode.value === "otp");

const authTitle = computed(() => {
  if (isRegister.value) {
    return "Create your account";
  }
  if (isForgot.value) {
    return "Reset your password";
  }
  if (isOtp.value) {
    return "Use one-time code";
  }
  return "Welcome back";
});

const authSubtitle = computed(() => {
  if (isRegister.value) {
    return "Register to access your workspace.";
  }
  if (isForgot.value) {
    return "We will send password reset instructions to your email.";
  }
  if (isOtp.value) {
    return "Request a one-time login code and verify it below.";
  }
  return "Sign in to continue.";
});

const submitLabel = computed(() => {
  if (isRegister.value) {
    return "Register";
  }
  if (isForgot.value) {
    return "Send reset instructions";
  }
  if (isOtp.value) {
    return "Verify code";
  }
  return "Sign in";
});

const emailErrorMessages = computed(() => {
  const shouldValidate = submitAttempted.value || emailTouched.value;
  if (!shouldValidate) {
    return [];
  }

  const value = String(email.value || "").trim();
  if (!value) {
    return ["Email is required."];
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return ["Enter a valid email address."];
  }
  return [];
});

const passwordErrorMessages = computed(() => {
  const shouldValidate = submitAttempted.value || passwordTouched.value;
  if (!shouldValidate || isForgot.value || isOtp.value) {
    return [];
  }
  if (!String(password.value || "").trim()) {
    return ["Password is required."];
  }
  if (isRegister.value && String(password.value || "").trim().length < 8) {
    return ["Password must be at least 8 characters."];
  }
  return [];
});

const confirmPasswordErrorMessages = computed(() => {
  const shouldValidate = submitAttempted.value || confirmPasswordTouched.value;
  if (!shouldValidate || !isRegister.value) {
    return [];
  }
  if (String(confirmPassword.value || "").trim() !== String(password.value || "").trim()) {
    return ["Passwords do not match."];
  }
  return [];
});

const otpCodeErrorMessages = computed(() => {
  const shouldValidate = submitAttempted.value || otpCodeTouched.value;
  if (!shouldValidate || !isOtp.value) {
    return [];
  }
  if (!String(otpCode.value || "").trim()) {
    return ["One-time code is required."];
  }
  return [];
});

const canSubmit = computed(() => {
  if (loading.value) {
    return false;
  }

  if (emailErrorMessages.value.length > 0) {
    return false;
  }

  if (isRegister.value || isLogin.value) {
    return passwordErrorMessages.value.length < 1 && confirmPasswordErrorMessages.value.length < 1;
  }
  if (isOtp.value) {
    return otpCodeErrorMessages.value.length < 1;
  }
  return true;
});

function normalizeReturnToPath(value, fallback = "/app") {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw === "/login") {
    return fallback;
  }
  return raw;
}

const requestedReturnTo = ref(
  normalizeReturnToPath(
    typeof window === "object" ? new URLSearchParams(window.location.search || "").get("returnTo") : "/app",
    "/app"
  )
);

function stripOAuthParamsFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  const oauthParamKeys = [
    "code",
    "access_token",
    "refresh_token",
    "provider_token",
    "expires_in",
    "expires_at",
    "token_type",
    "state",
    "sb",
    "type",
    "error",
    "error_description",
    "errorCode",
    "errorDescription",
    OAUTH_QUERY_PARAM_PROVIDER,
    OAUTH_QUERY_PARAM_RETURN_TO
  ];

  oauthParamKeys.forEach((key) => {
    nextUrl.searchParams.delete(key);
  });

  const hashParams = new URLSearchParams((nextUrl.hash || "").replace(/^#/, ""));
  oauthParamKeys.forEach((key) => {
    hashParams.delete(key);
  });

  const nextHash = hashParams.toString();
  window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextHash ? `#${nextHash}` : ""}`);
}

function readOAuthCallbackParamsFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search || "");
  const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

  const code = String(searchParams.get("code") || hashParams.get("code") || "").trim();
  const accessToken = String(searchParams.get("access_token") || hashParams.get("access_token") || "").trim();
  const refreshToken = String(searchParams.get("refresh_token") || hashParams.get("refresh_token") || "").trim();
  const errorCode = String(
    searchParams.get("error") ||
      hashParams.get("error") ||
      searchParams.get("errorCode") ||
      hashParams.get("errorCode") ||
      ""
  ).trim();
  const errorDescription = String(
    searchParams.get("error_description") ||
      hashParams.get("error_description") ||
      searchParams.get("errorDescription") ||
      hashParams.get("errorDescription") ||
      ""
  ).trim();
  const hasSessionPair = Boolean(accessToken && refreshToken);

  if (!code && !hasSessionPair && !errorCode) {
    return null;
  }

  return {
    code,
    accessToken,
    refreshToken,
    hasSessionPair,
    errorCode,
    errorDescription,
    provider: String(searchParams.get(OAUTH_QUERY_PARAM_PROVIDER) || "").trim().toLowerCase(),
    returnTo: String(searchParams.get(OAUTH_QUERY_PARAM_RETURN_TO) || "").trim()
  };
}

function clearTransientMessages() {
  errorMessage.value = "";
  infoMessage.value = "";
}

function resetTransientValidationState() {
  submitAttempted.value = false;
  emailTouched.value = false;
  passwordTouched.value = false;
  confirmPasswordTouched.value = false;
  otpCodeTouched.value = false;
}

function switchMode(nextMode) {
  if (nextMode === mode.value) {
    return;
  }
  mode.value = nextMode;
  password.value = "";
  confirmPassword.value = "";
  otpCode.value = "";
  showPassword.value = false;
  showConfirmPassword.value = false;
  clearTransientMessages();
  resetTransientValidationState();
}

function oauthProviderButtonLabel(provider) {
  const providerLabel = String(provider?.label || provider?.id || "OAuth provider");
  if (isRegister.value) {
    return `Register with ${providerLabel}`;
  }
  return `Continue with ${providerLabel}`;
}

function oauthProviderIcon(provider) {
  if (String(provider?.id || "").toLowerCase() === "google") {
    return mdiGoogle;
  }
  return undefined;
}

async function request(path, options = {}) {
  return authHttpRequest(path, {
    method: options.method || "GET",
    ...(options.body ? { body: options.body } : {})
  });
}

function applySessionPayload(payload) {
  oauthProviders.value = Array.isArray(payload?.oauthProviders)
    ? payload.oauthProviders
        .map((provider) => {
          if (!provider || typeof provider !== "object") {
            return null;
          }
          const id = String(provider.id || "")
            .trim()
            .toLowerCase();
          if (!id) {
            return null;
          }
          return {
            id,
            label: String(provider.label || id).trim() || id
          };
        })
        .filter(Boolean)
    : [];

  oauthDefaultProvider.value = String(payload?.oauthDefaultProvider || "")
    .trim()
    .toLowerCase();
}

function resolveDefaultOAuthProvider() {
  const explicit = oauthDefaultProvider.value;
  if (explicit) {
    return explicit;
  }
  return String(oauthProviders.value[0]?.id || "")
    .trim()
    .toLowerCase();
}

async function refreshSession() {
  const session = await request("/api/session");
  applySessionPayload(session);
  return session;
}

async function completeLogin() {
  const session = await refreshSession();
  if (!session?.authenticated) {
    throw new Error("Login succeeded but the session is not active yet. Please retry.");
  }
  if (typeof window === "object" && window.location) {
    window.location.replace(requestedReturnTo.value);
  }
}

async function handleOAuthCallbackIfPresent() {
  const callbackParams = readOAuthCallbackParamsFromLocation();
  if (!callbackParams) {
    return false;
  }

  requestedReturnTo.value = normalizeReturnToPath(callbackParams.returnTo, requestedReturnTo.value);

  const provider = String(callbackParams.provider || resolveDefaultOAuthProvider() || "")
    .trim()
    .toLowerCase();
  const oauthError = callbackParams.errorCode;
  const oauthErrorDescription = callbackParams.errorDescription;

  if (!provider) {
    errorMessage.value = "OAuth provider is missing from callback.";
    stripOAuthParamsFromLocation();
    return true;
  }

  if (oauthError) {
    errorMessage.value = oauthErrorDescription || oauthError;
    stripOAuthParamsFromLocation();
    return true;
  }

  loading.value = true;
  errorMessage.value = "";
  infoMessage.value = "";

  try {
    const payload = {
      provider
    };
    if (callbackParams.code) {
      payload.code = callbackParams.code;
    }
    if (callbackParams.hasSessionPair) {
      payload.accessToken = callbackParams.accessToken;
      payload.refreshToken = callbackParams.refreshToken;
    }

    await request("/api/oauth/complete", {
      method: "POST",
      body: payload
    });

    stripOAuthParamsFromLocation();
    await completeLogin();
  } catch (error) {
    errorMessage.value = String(error?.message || "Unable to complete OAuth sign-in.");
    stripOAuthParamsFromLocation();
  } finally {
    loading.value = false;
  }

  return true;
}

async function submitAuth() {
  submitAttempted.value = true;
  clearTransientMessages();
  if (!canSubmit.value) {
    return;
  }

  loading.value = true;

  try {
    const normalizedEmail = String(email.value || "").trim().toLowerCase();

    if (isRegister.value) {
      await request("/api/register", {
        method: "POST",
        body: {
          email: normalizedEmail,
          password: String(password.value || "")
        }
      });
      await completeLogin();
      return;
    }

    if (isForgot.value) {
      await request("/api/password/forgot", {
        method: "POST",
        body: { email: normalizedEmail }
      });
      infoMessage.value = "Password reset instructions sent.";
      return;
    }

    if (isOtp.value) {
      await request("/api/login/otp/verify", {
        method: "POST",
        body: {
          email: normalizedEmail,
          token: String(otpCode.value || "").trim(),
          type: "email"
        }
      });
      await completeLogin();
      return;
    }

    await request("/api/login", {
      method: "POST",
      body: {
        email: normalizedEmail,
        password: String(password.value || "")
      }
    });
    await completeLogin();
  } catch (error) {
    errorMessage.value = String(error?.message || "Authentication failed.");
  } finally {
    loading.value = false;
  }
}

async function requestOtpCode() {
  otpRequestPending.value = true;
  errorMessage.value = "";
  infoMessage.value = "";
  try {
    const normalizedEmail = String(email.value || "").trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error("Email is required to request a one-time code.");
    }
    await request("/api/login/otp/request", {
      method: "POST",
      body: {
        email: normalizedEmail,
        returnTo: requestedReturnTo.value
      }
    });
    infoMessage.value = "One-time code sent. Check your inbox.";
  } catch (error) {
    errorMessage.value = String(error?.message || "Unable to request one-time code.");
  } finally {
    otpRequestPending.value = false;
  }
}

function startOAuthSignIn(providerId) {
  const provider = String(providerId || "").trim().toLowerCase();
  if (!provider || typeof window !== "object" || !window.location) {
    return;
  }

  const params = new URLSearchParams({
    returnTo: requestedReturnTo.value
  });
  window.location.assign(`/api/oauth/${encodeURIComponent(provider)}/start?${params.toString()}`);
}

onMounted(async () => {
  loading.value = true;
  try {
    const session = await refreshSession();
    const callbackHandled = await handleOAuthCallbackIfPresent();
    if (!callbackHandled && session?.authenticated && typeof window === "object" && window.location) {
      window.location.replace(requestedReturnTo.value);
      return;
    }
  } catch (error) {
    errorMessage.value = String(error?.message || "Unable to initialize sign in.");
  } finally {
    loading.value = false;
  }
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
