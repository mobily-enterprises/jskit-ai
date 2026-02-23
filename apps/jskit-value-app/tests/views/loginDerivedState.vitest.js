import { ref } from "vue";
import { describe, expect, it } from "vitest";

import { useLoginDerivedState } from "../../src/views/login/lib/useLoginDerivedState.js";

function createState(overrides = {}) {
  const mode = ref(overrides.mode || "login");
  const rememberedAccount = ref(overrides.rememberedAccount || null);
  const useRememberedAccount = ref(Boolean(overrides.useRememberedAccount));
  const submitAttempted = ref(Boolean(overrides.submitAttempted));
  const emailTouched = ref(Boolean(overrides.emailTouched));
  const passwordTouched = ref(Boolean(overrides.passwordTouched));
  const confirmPasswordTouched = ref(Boolean(overrides.confirmPasswordTouched));
  const otpCodeTouched = ref(Boolean(overrides.otpCodeTouched));
  const email = ref(overrides.email || "");
  const password = ref(overrides.password || "");
  const confirmPassword = ref(overrides.confirmPassword || "");
  const otpCode = ref(overrides.otpCode || "");
  const loading = ref(Boolean(overrides.loading));

  const vm = useLoginDerivedState({
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
  });

  return {
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
    loading,
    vm
  };
}

describe("useLoginDerivedState", () => {
  it("derives mode-driven labels and remembered account helpers", () => {
    const state = createState({
      mode: "login",
      rememberedAccount: {
        displayName: "Tony",
        maskedEmail: "t***@example.com"
      },
      useRememberedAccount: true
    });

    expect(state.vm.isLogin.value).toBe(true);
    expect(state.vm.showRememberedAccount.value).toBe(true);
    expect(state.vm.rememberedAccountDisplayName.value).toBe("Tony");
    expect(state.vm.rememberedAccountMaskedEmail.value).toBe("t***@example.com");
    expect(state.vm.rememberedAccountSwitchLabel.value).toBe("Not Tony?");
    expect(state.vm.authTitle.value).toBe("Sign in");
    expect(state.vm.submitLabel.value).toBe("Sign in");

    state.mode.value = "register";
    expect(state.vm.isRegister.value).toBe(true);
    expect(state.vm.authTitle.value).toBe("Register to continue");
    expect(state.vm.authSubtitle.value).toContain("Create a new account");
    expect(state.vm.submitLabel.value).toBe("Create account");

    state.mode.value = "forgot";
    expect(state.vm.isForgot.value).toBe(true);
    expect(state.vm.authTitle.value).toBe("Reset your password");
    expect(state.vm.submitLabel.value).toBe("Send reset link");

    state.mode.value = "otp";
    expect(state.vm.isOtp.value).toBe(true);
    expect(state.vm.authTitle.value).toBe("Sign in with one-time code");
    expect(state.vm.submitLabel.value).toBe("Verify code");
  });

  it("computes validation errors and canSubmit across branches", () => {
    const state = createState({
      mode: "register",
      email: "invalid",
      password: "short",
      confirmPassword: "different",
      submitAttempted: true,
      emailTouched: true,
      passwordTouched: true,
      confirmPasswordTouched: true
    });

    expect(state.vm.emailError.value).not.toBe("");
    expect(state.vm.emailErrorMessages.value.length).toBeGreaterThan(0);
    expect(state.vm.passwordErrorMessages.value.length).toBeGreaterThan(0);
    expect(state.vm.confirmPasswordErrorMessages.value.length).toBeGreaterThan(0);
    expect(state.vm.canSubmit.value).toBe(false);

    state.mode.value = "forgot";
    state.email.value = "user@example.com";
    expect(state.vm.passwordErrorMessages.value).toEqual([]);

    state.mode.value = "otp";
    state.otpCodeTouched.value = true;
    state.otpCode.value = "";
    expect(state.vm.otpCodeErrorMessages.value).toEqual(["One-time code is required."]);
    expect(state.vm.canSubmit.value).toBe(false);

    state.otpCode.value = "x".repeat(2049);
    expect(state.vm.otpCodeErrorMessages.value).toEqual(["One-time code is too long."]);

    state.otpCode.value = "123456";
    state.loading.value = true;
    expect(state.vm.canSubmit.value).toBe(false);

    state.loading.value = false;
    expect(state.vm.canSubmit.value).toBe(true);
  });

  it("covers hidden/error-message branches and canSubmit guard ordering", () => {
    const state = createState({
      mode: "login",
      email: "",
      password: "",
      submitAttempted: false,
      emailTouched: false,
      passwordTouched: false
    });

    expect(state.vm.showRememberedAccount.value).toBe(false);
    expect(state.vm.rememberedAccountDisplayName.value).toBe("your account");
    expect(state.vm.rememberedAccountMaskedEmail.value).toBe("");
    expect(state.vm.rememberedAccountSwitchLabel.value).toBe("Use another account");
    expect(state.vm.emailErrorMessages.value).toEqual([]);
    expect(state.vm.passwordErrorMessages.value).toEqual([]);
    expect(state.vm.confirmPasswordErrorMessages.value).toEqual([]);
    expect(state.vm.otpCodeErrorMessages.value).toEqual([]);
    expect(state.vm.canSubmit.value).toBe(false);

    state.email.value = "user@example.com";
    state.password.value = "password123";
    expect(state.vm.canSubmit.value).toBe(true);

    state.mode.value = "register";
    state.confirmPassword.value = "different";
    state.confirmPasswordTouched.value = true;
    expect(state.vm.confirmPasswordErrorMessages.value.length).toBeGreaterThan(0);
    expect(state.vm.canSubmit.value).toBe(false);

    state.confirmPassword.value = "password123";
    expect(state.vm.canSubmit.value).toBe(true);

    state.mode.value = "otp";
    state.submitAttempted.value = false;
    state.otpCodeTouched.value = false;
    state.otpCode.value = "";
    expect(state.vm.otpCodeErrorMessages.value).toEqual([]);
    state.otpCodeTouched.value = true;
    expect(state.vm.otpCodeErrorMessages.value).toEqual(["One-time code is required."]);
  });
});
