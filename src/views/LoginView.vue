<template>
  <v-app>
    <v-main class="login-main">
      <v-container class="fill-height d-flex align-center justify-center py-8">
        <div class="auth-shell">
          <v-row class="auth-layout" align="stretch">
            <v-col cols="12" md="6" class="pa-0">
              <section class="brand-panel">
                <p class="eyebrow">Financial Workspace</p>
                <h1 class="brand-title">Annuity Calculator</h1>
                <p class="brand-copy">
                  Secure sign-in for professional annuity analysis with server-side calculations and saved history.
                </p>
                <ul class="brand-points">
                  <li>Server-calculated present and future values</li>
                  <li>Login-protected calculation history</li>
                  <li>Clear validation and auditable assumptions</li>
                </ul>
              </section>
            </v-col>

            <v-col cols="12" md="6" class="pa-0">
              <v-card class="auth-card" rounded="xl" elevation="12">
                <v-card-text class="auth-content">
                  <p class="auth-kicker">{{ authKicker }}</p>
                  <h2 class="auth-title">{{ authTitle }}</h2>
                  <p class="text-medium-emphasis mb-6">{{ authSubtitle }}</p>

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

                    <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
                      {{ errorMessage }}
                    </v-alert>

                    <v-alert v-if="infoMessage" type="info" variant="tonal" class="mb-4">
                      {{ infoMessage }}
                    </v-alert>

                    <v-btn block color="primary" size="large" :loading="loading" :disabled="!canSubmit" type="submit">
                      {{ submitLabel }}
                    </v-btn>

                    <div v-if="isLogin" class="switch-row">
                      <span class="text-medium-emphasis">Need an account?</span>
                      <v-btn variant="text" color="secondary" @click="switchMode('register')">Create account</v-btn>
                    </div>

                    <div v-else-if="isRegister" class="switch-row">
                      <span class="text-medium-emphasis">Already have an account?</span>
                      <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
                    </div>

                    <div v-else class="switch-row">
                      <span class="text-medium-emphasis">Remembered your password?</span>
                      <v-btn variant="text" color="secondary" @click="switchMode('login')">Back to sign in</v-btn>
                    </div>
                  </v-form>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </div>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import { validators } from "../../shared/auth/validators.js";
import { normalizeEmail } from "../../shared/auth/utils.js";

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

const isLogin = computed(() => mode.value === "login");
const isRegister = computed(() => mode.value === "register");
const isForgot = computed(() => mode.value === "forgot");

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
  () => registerMutation.isPending.value || loginMutation.isPending.value || forgotPasswordMutation.isPending.value
);

const authKicker = computed(() => {
  if (isRegister.value) {
    return "Create account";
  }
  if (isForgot.value) {
    return "Recover access";
  }
  return "Welcome back";
});

const authTitle = computed(() => {
  if (isRegister.value) {
    return "Register to continue";
  }
  if (isForgot.value) {
    return "Reset your password";
  }
  return "Sign in to continue";
});

const authSubtitle = computed(() => {
  if (isRegister.value) {
    return "Create a new account to access calculations.";
  }
  if (isForgot.value) {
    return "Enter your email and we will send you a secure password reset link.";
  }
  return "Use your account credentials.";
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

async function redirectRecoveryLinkToResetPage() {
  if (!hasRecoveryLinkPayload()) {
    return;
  }

  if (typeof window !== "undefined") {
    window.location.replace(`/reset-password${window.location.search || ""}${window.location.hash || ""}`);
  }
}

function resetValidationState() {
  emailTouched.value = false;
  passwordTouched.value = false;
  confirmPasswordTouched.value = false;
  submitAttempted.value = false;
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

    await navigate({ to: "/", replace: true });
  } catch (error) {
    errorMessage.value = toErrorMessage(error, "Unable to complete authentication.");
  }
}

onMounted(() => {
  redirectRecoveryLinkToResetPage();
});
</script>

<style scoped>
.login-main {
  background:
    radial-gradient(circle at 12% 10%, rgba(0, 104, 74, 0.24), transparent 45%),
    radial-gradient(circle at 92% 92%, rgba(220, 156, 34, 0.2), transparent 40%),
    linear-gradient(160deg, #eef2ea 0%, #f8faf7 100%);
}

.auth-shell {
  width: min(980px, 100%);
}

.auth-layout {
  overflow: hidden;
  border-radius: 24px;
}

.brand-panel {
  height: 100%;
  padding: 48px 40px;
  color: #f7fdf8;
  background:
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.15), transparent 40%),
    linear-gradient(145deg, #0b4f3b, #1f6b50);
}

.eyebrow {
  margin: 0 0 14px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.86;
}

.brand-title {
  margin: 0 0 14px;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.1;
}

.brand-copy {
  margin: 0 0 18px;
  font-size: 16px;
  line-height: 1.5;
  opacity: 0.92;
}

.brand-points {
  margin: 0;
  padding-left: 18px;
  line-height: 1.65;
}

.auth-card {
  height: 100%;
}

.auth-content {
  padding: 40px;
}

.auth-kicker {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #355347;
}

.auth-title {
  margin: 6px 0 8px;
  font-size: 30px;
  line-height: 1.2;
  color: #1d2c24;
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

@media (max-width: 959px) {
  .brand-panel {
    padding: 28px 24px;
  }

  .auth-content {
    padding: 28px 24px;
  }

  .auth-title {
    font-size: 26px;
  }
}
</style>
