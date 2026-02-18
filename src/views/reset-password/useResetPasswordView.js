import { computed, onMounted, reactive, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation } from "@tanstack/vue-query";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api/index.js";
import { useAuthStore } from "../../stores/authStore.js";
import { validators } from "../../../shared/auth/validators.js";

function toSingleMessage(error, fallback) {
  if (error?.fieldErrors && typeof error.fieldErrors === "object") {
    const details = Object.values(error.fieldErrors).filter(Boolean);
    if (details.length > 0) {
      return details.join(" ");
    }
  }

  return String(error?.message || fallback);
}

export function useResetPasswordView() {
  const navigate = useNavigate();
  const surfacePaths = computed(() =>
    resolveSurfacePaths(typeof window !== "undefined" ? window.location.pathname : "/")
  );
  const authStore = useAuthStore();

  const password = ref("");
  const confirmPassword = ref("");
  const showPassword = ref(false);
  const showConfirmPassword = ref(false);
  const passwordTouched = ref(false);
  const confirmPasswordTouched = ref(false);
  const submitAttempted = ref(false);
  const initializing = ref(true);
  const readyForPasswordUpdate = ref(false);
  const recoveryError = ref("");
  const formError = ref("");
  const formSuccess = ref("");

  const completeRecoveryMutation = useMutation({
    mutationFn: (payload) => api.completePasswordRecovery(payload)
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (payload) => api.resetPassword(payload)
  });

  const loading = computed(() => completeRecoveryMutation.isPending.value || resetPasswordMutation.isPending.value);

  function clearRecoveryParamsFromUrl() {
    if (typeof window === "undefined" || !window.history?.replaceState) {
      return;
    }

    window.history.replaceState({}, "", surfacePaths.value.resetPasswordPath);
  }

  function parseRecoveryPayloadFromLocation() {
    if (typeof window === "undefined") {
      return { payload: null, linkError: "Recovery link is unavailable in this environment." };
    }

    const search = new URLSearchParams(window.location.search || "");
    const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

    const linkErrorDescription = search.get("error_description") || hash.get("error_description") || "";
    if (linkErrorDescription) {
      return { payload: null, linkError: linkErrorDescription };
    }

    const code = search.get("code") || "";
    const tokenHash = search.get("token_hash") || hash.get("token_hash") || "";
    const accessToken = hash.get("access_token") || search.get("access_token") || "";
    const refreshToken = hash.get("refresh_token") || search.get("refresh_token") || "";

    const payload = {};
    if (code) {
      payload.code = code;
    }
    if (tokenHash) {
      payload.tokenHash = tokenHash;
      payload.type = "recovery";
    }
    if (accessToken && refreshToken) {
      payload.accessToken = accessToken;
      payload.refreshToken = refreshToken;
      payload.type = "recovery";
    }

    return {
      payload: Object.keys(payload).length > 0 ? payload : null,
      linkError: ""
    };
  }

  async function initializeRecovery() {
    initializing.value = true;
    recoveryError.value = "";
    formError.value = "";

    const parsed = parseRecoveryPayloadFromLocation();
    if (parsed.linkError) {
      recoveryError.value = parsed.linkError;
      initializing.value = false;
      return;
    }

    try {
      if (parsed.payload) {
        await completeRecoveryMutation.mutateAsync(parsed.payload);
        clearRecoveryParamsFromUrl();
        const session = await authStore.refreshSession();
        if (!session?.authenticated) {
          throw new Error("Unable to establish a recovery session. Request a new reset link.");
        }
        readyForPasswordUpdate.value = true;
        initializing.value = false;
        return;
      }

      const session = await authStore.ensureSession({ force: true });
      if (session?.authenticated) {
        readyForPasswordUpdate.value = true;
      } else {
        recoveryError.value = "Recovery link is missing or expired. Request a new password reset email.";
      }
    } catch (error) {
      recoveryError.value = toSingleMessage(error, "Recovery link is invalid or expired. Request a new one.");
    }

    initializing.value = false;
  }

  const passwordError = computed(() => {
    return validators.resetPassword(password.value);
  });

  const confirmPasswordError = computed(() => {
    return validators.confirmPassword({
      password: password.value,
      confirmPassword: confirmPassword.value
    });
  });

  const passwordErrorMessages = computed(() => {
    if (!submitAttempted.value && !passwordTouched.value) {
      return [];
    }
    return passwordError.value ? [passwordError.value] : [];
  });

  const confirmPasswordErrorMessages = computed(() => {
    if (!submitAttempted.value && !confirmPasswordTouched.value) {
      return [];
    }
    return confirmPasswordError.value ? [confirmPasswordError.value] : [];
  });

  const canSubmit = computed(() => {
    if (loading.value || !readyForPasswordUpdate.value) {
      return false;
    }

    return !passwordError.value && !confirmPasswordError.value;
  });

  async function submitPasswordReset() {
    submitAttempted.value = true;
    formError.value = "";
    formSuccess.value = "";

    if (!canSubmit.value) {
      return;
    }

    try {
      const response = await resetPasswordMutation.mutateAsync({
        password: password.value
      });

      authStore.setSignedOut();
      await authStore.invalidateSession();
      formSuccess.value = String(response?.message || "Password updated. Sign in with your new password.");
      readyForPasswordUpdate.value = false;
    } catch (error) {
      formError.value = toSingleMessage(error, "Unable to reset password. Please retry.");
    }
  }

  async function goToLogin() {
    await navigate({ to: surfacePaths.value.loginPath, replace: true });
  }

  onMounted(() => {
    initializeRecovery();
  });

  return {
    form: reactive({
      password,
      confirmPassword,
      showPassword,
      showConfirmPassword,
      passwordTouched,
      confirmPasswordTouched
    }),
    status: reactive({
      initializing,
      readyForPasswordUpdate,
      recoveryError,
      formError,
      formSuccess,
      loading
    }),
    validation: reactive({
      passwordErrorMessages,
      confirmPasswordErrorMessages,
      canSubmit
    }),
    actions: {
      submitPasswordReset,
      goToLogin
    }
  };
}
