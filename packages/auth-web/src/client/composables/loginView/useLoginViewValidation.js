import { computed } from "vue";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpVerifyCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetRequestCommand";
import {
  validateCommandSection,
  resolveFieldValidationMessage
} from "./validationHelpers.js";

export function useLoginViewValidation({ state } = {}) {
  function resolveFieldErrorMessages({
    shouldValidate,
    commandResource,
    section = "bodyValidator",
    payload,
    fieldName
  } = {}) {
    if (!shouldValidate) {
      return [];
    }

    const parsed = validateCommandSection(commandResource, section, payload);
    const message = resolveFieldValidationMessage(parsed, fieldName);
    return message ? [message] : [];
  }

  const emailErrorMessages = computed(() => {
    const shouldValidate = state.submitAttempted.value || state.emailTouched.value;
    const normalizedEmail = state.resolveNormalizedEmail();
    const command = state.isRegister.value
      ? authRegisterCommand
      : state.isForgot.value
        ? authPasswordResetRequestCommand
        : state.isOtp.value
          ? authLoginOtpRequestCommand
          : authLoginPasswordCommand;
    const payload = state.isRegister.value || state.isLogin.value
      ? {
          email: normalizedEmail,
          password: String(state.password.value || "")
        }
      : {
          email: normalizedEmail
        };

    return resolveFieldErrorMessages({
      shouldValidate,
      commandResource: command,
      payload,
      fieldName: "email"
    });
  });

  const passwordErrorMessages = computed(() => {
    const shouldValidate = state.submitAttempted.value || state.passwordTouched.value;
    if (!shouldValidate || state.isForgot.value || state.isOtp.value) {
      return [];
    }

    const normalizedEmail = state.resolveNormalizedEmail();
    const command = state.isRegister.value ? authRegisterCommand : authLoginPasswordCommand;
    return resolveFieldErrorMessages({
      shouldValidate: true,
      commandResource: command,
      payload: {
        email: normalizedEmail,
        password: String(state.password.value || "")
      },
      fieldName: "password"
    });
  });

  const confirmPasswordErrorMessages = computed(() => {
    const shouldValidate = state.submitAttempted.value || state.confirmPasswordTouched.value;
    if (!shouldValidate || !state.isRegister.value) {
      return [];
    }
    if (String(state.confirmPassword.value || "").trim() !== String(state.password.value || "").trim()) {
      return ["Passwords do not match."];
    }
    return [];
  });

  const otpCodeErrorMessages = computed(() => {
    const shouldValidate = state.submitAttempted.value || state.otpCodeTouched.value;
    return resolveFieldErrorMessages({
      shouldValidate: shouldValidate && state.isOtp.value,
      commandResource: authLoginOtpVerifyCommand,
      payload: {
        token: String(state.otpCode.value || "").trim()
      },
      fieldName: "token"
    });
  });

  const canSubmit = computed(() => {
    if (state.isEmailConfirmationPending.value) {
      return false;
    }
    if (state.loading.value) {
      return false;
    }
    if (emailErrorMessages.value.length > 0) {
      return false;
    }
    if (state.isRegister.value || state.isLogin.value) {
      return passwordErrorMessages.value.length < 1 && confirmPasswordErrorMessages.value.length < 1;
    }
    if (state.isOtp.value) {
      return otpCodeErrorMessages.value.length < 1;
    }
    return true;
  });

  return {
    emailErrorMessages,
    passwordErrorMessages,
    confirmPasswordErrorMessages,
    otpCodeErrorMessages,
    canSubmit
  };
}
