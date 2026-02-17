import { computed } from "vue";
import { validators } from "../../../../shared/auth/validators.js";

export function useLoginDerivedState({
  mode,
  rememberedAccount,
  useRememberedAccount,
  submitAttempted,
  emailTouched,
  passwordTouched,
  confirmPasswordTouched,
  otpCodeTouched,
  email,
  password,
  confirmPassword,
  otpCode,
  loading
}) {
  const isLogin = computed(() => mode.value === "login");
  const isRegister = computed(() => mode.value === "register");
  const isForgot = computed(() => mode.value === "forgot");
  const isOtp = computed(() => mode.value === "otp");
  const showRememberedAccount = computed(
    () => (isLogin.value || isOtp.value) && useRememberedAccount.value && Boolean(rememberedAccount.value)
  );
  const rememberedAccountDisplayName = computed(() => String(rememberedAccount.value?.displayName || "your account"));
  const rememberedAccountMaskedEmail = computed(() => String(rememberedAccount.value?.maskedEmail || ""));
  const rememberedAccountSwitchLabel = computed(() => {
    const shortName = String(rememberedAccount.value?.displayName || "").trim();
    return shortName ? `Not ${shortName}?` : "Use another account";
  });

  const authTitle = computed(() => {
    if (isRegister.value) {
      return "Register to continue";
    }
    if (isForgot.value) {
      return "Reset your password";
    }
    if (isOtp.value) {
      return "Sign in with one-time code";
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
    if (isOtp.value) {
      return "Send a one-time login code to your email, then enter it here.";
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
    if (isOtp.value) {
      return "Verify code";
    }
    return "Sign in";
  });

  const emailError = computed(() => {
    return validators.email(email.value);
  });

  const passwordError = computed(() => {
    if (isForgot.value || isOtp.value) {
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

  const otpCodeError = computed(() => {
    if (!isOtp.value) {
      return "";
    }

    const token = String(otpCode.value || "").trim();
    if (!token) {
      return "One-time code is required.";
    }
    if (token.length > 2048) {
      return "One-time code is too long.";
    }

    return "";
  });

  const emailErrorMessages = computed(() => {
    if (!submitAttempted.value && !emailTouched.value) {
      return [];
    }
    return emailError.value ? [emailError.value] : [];
  });

  const passwordErrorMessages = computed(() => {
    if (isForgot.value || isOtp.value || (!submitAttempted.value && !passwordTouched.value)) {
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

  const otpCodeErrorMessages = computed(() => {
    if (!isOtp.value || (!submitAttempted.value && !otpCodeTouched.value)) {
      return [];
    }
    return otpCodeError.value ? [otpCodeError.value] : [];
  });

  const canSubmit = computed(() => {
    if (loading.value) {
      return false;
    }

    if (emailError.value) {
      return false;
    }

    if (!isForgot.value && !isOtp.value && passwordError.value) {
      return false;
    }

    if (isRegister.value && confirmPasswordError.value) {
      return false;
    }

    if (isOtp.value && otpCodeError.value) {
      return false;
    }

    return true;
  });

  return {
    isLogin,
    isRegister,
    isForgot,
    isOtp,
    showRememberedAccount,
    rememberedAccountDisplayName,
    rememberedAccountMaskedEmail,
    rememberedAccountSwitchLabel,
    authTitle,
    authSubtitle,
    submitLabel,
    emailError,
    emailErrorMessages,
    passwordErrorMessages,
    confirmPasswordErrorMessages,
    otpCodeErrorMessages,
    canSubmit
  };
}
