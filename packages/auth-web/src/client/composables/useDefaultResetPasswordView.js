import { computed, onMounted, ref } from "vue";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { authPasswordResetCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetCommand";
import { authHttpRequest } from "../runtime/authHttpClient.js";
import {
  readPasswordRecoveryCallbackPayloadFromUrl,
  stripPasswordRecoveryCallbackParamsFromLocation
} from "../runtime/passwordRecoveryCallbackRuntime.js";
import {
  validateCommandSection,
  resolveFieldValidationMessage
} from "./loginView/validationHelpers.js";
import { useJskitText } from "../i18n.js";

/** The password reset page: it exchanges the recovery link on mount, then sets the new password. */
export function useDefaultResetPasswordView() {
  const { serverMessage, t } = useJskitText();
  const status = ref("checking");
  const loading = ref(false);
  const errorMessage = ref("");
  const password = ref("");
  const confirmPassword = ref("");
  const showPassword = ref(false);
  const showConfirmPassword = ref(false);

  const resetPasswordPayload = computed(() => ({
    password: password.value
  }));
  const resetPasswordValidation = computed(() =>
    validateCommandSection(authPasswordResetCommand, "body", resetPasswordPayload.value)
  );
  const passwordError = computed(() => {
    if (!password.value) {
      return [];
    }
    const message = resolveFieldValidationMessage(resetPasswordValidation.value, "password");
    return message ? [message] : [];
  });
  const confirmPasswordError = computed(() => {
    if (!confirmPassword.value) {
      return [];
    }
    return password.value === confirmPassword.value ? [] : [t("jskit.auth.resetPassword.passwordsMustMatch")];
  });
  const canSubmit = computed(() =>
    Boolean(password.value) &&
    resetPasswordValidation.value.ok === true &&
    password.value === confirmPassword.value &&
    loading.value !== true
  );

  async function exchangeRecoveryToken() {
    const recoveryPayload = readPasswordRecoveryCallbackPayloadFromUrl(window.location.href);
    if (!recoveryPayload) {
      status.value = "ready";
      return;
    }
    try {
      await authHttpRequest(AUTH_PATHS.PASSWORD_RECOVERY, {
        method: "POST",
        body: recoveryPayload
      });
      stripPasswordRecoveryCallbackParamsFromLocation();
      status.value = "ready";
    } catch (error) {
      status.value = "error";
      errorMessage.value = serverMessage(error, t("jskit.auth.resetPassword.recoveryInvalid"));
    }
  }

  async function submitReset() {
    if (!canSubmit.value) {
      return;
    }
    loading.value = true;
    errorMessage.value = "";
    try {
      await authHttpRequest(AUTH_PATHS.PASSWORD_RESET, {
        method: "POST",
        body: {
          password: password.value
        }
      });
      status.value = "done";
      password.value = "";
      confirmPassword.value = "";
    } catch (error) {
      errorMessage.value = serverMessage(error, t("jskit.auth.resetPassword.updateFailed"));
    } finally {
      loading.value = false;
    }
  }

  onMounted(exchangeRecoveryToken);

  return {
    status,
    loading,
    errorMessage,
    password,
    confirmPassword,
    showPassword,
    showConfirmPassword,
    passwordError,
    confirmPasswordError,
    canSubmit,
    submitReset
  };
}
