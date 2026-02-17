import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    bootstrap: vi.fn(),
    oauthComplete: vi.fn(),
    oauthStartUrl: vi.fn((provider, { returnTo }) => `/api/oauth/${provider}/start?returnTo=${returnTo}`)
  },
  oauthUtils: {
    clearPendingOAuthContext: vi.fn(),
    readOAuthCallbackStateFromLocation: vi.fn(),
    readPendingOAuthContext: vi.fn(),
    stripOAuthCallbackParamsFromLocation: vi.fn(),
    writePendingOAuthContext: vi.fn()
  },
  storage: {
    clearRememberedAccountHint: vi.fn(),
    createRememberedAccountHint: vi.fn(),
    readRememberedAccountHint: vi.fn(),
    writeRememberedAccountHint: vi.fn()
  },
  recovery: {
    hasRecoveryLinkPayload: vi.fn()
  },
  otpCallback: {
    readOtpLoginCallbackStateFromLocation: vi.fn(),
    stripOtpLoginCallbackParamsFromLocation: vi.fn()
  },
  errorMessage: {
    toErrorMessage: vi.fn((error, fallback) => String(error?.message || fallback))
  }
}));

vi.mock("../../src/services/api.js", () => ({
  api: mocks.api
}));
vi.mock("../../src/utils/oauthCallback.js", () => mocks.oauthUtils);
vi.mock("../../src/views/login/lib/loginRememberedAccountStorage.js", () => mocks.storage);
vi.mock("../../src/views/login/lib/loginRecoveryLink.js", () => mocks.recovery);
vi.mock("../../src/views/login/lib/loginOtpCallbackState.js", () => mocks.otpCallback);
vi.mock("../../src/views/login/lib/loginErrorMessage.js", () => mocks.errorMessage);

import { useLoginActions } from "../../src/views/login/lib/useLoginActions.js";

function createHarness({ initialMode = "login", canSubmitInitial = true } = {}) {
  const mode = ref(initialMode);
  const email = ref("user@example.com");
  const password = ref("password123");
  const confirmPassword = ref("password123");
  const otpCode = ref("123456");
  const showPassword = ref(true);
  const showConfirmPassword = ref(true);
  const emailTouched = ref(true);
  const passwordTouched = ref(true);
  const confirmPasswordTouched = ref(true);
  const otpCodeTouched = ref(true);
  const submitAttempted = ref(true);
  const errorMessage = ref("");
  const infoMessage = ref("existing");
  const rememberAccountOnDevice = ref(true);
  const rememberedAccount = ref({
    displayName: "Tony",
    maskedEmail: "t***@example.com",
    lastUsedAt: "2026-02-17T00:00:00.000Z"
  });
  const useRememberedAccount = ref(true);
  const oauthCallbackInFlight = ref(false);

  const isRegister = computed(() => mode.value === "register");
  const isForgot = computed(() => mode.value === "forgot");
  const isOtp = computed(() => mode.value === "otp");
  const showRememberedAccount = computed(
    () => (mode.value === "login" || mode.value === "otp") && useRememberedAccount.value && Boolean(rememberedAccount.value)
  );
  const rememberedAccountDisplayName = computed(() => String(rememberedAccount.value?.displayName || "your account"));

  const canSubmitFlag = ref(canSubmitInitial);
  const canSubmit = computed(() => canSubmitFlag.value);

  const surfacePaths = ref({
    rootPath: "/",
    resetPasswordPath: "/reset-password",
    loginPath: "/login"
  });

  const navigate = vi.fn(async () => undefined);
  const authStore = {
    applySession: vi.fn()
  };
  const workspaceStore = {
    applyBootstrap: vi.fn()
  };

  const registerMutation = {
    mutateAsync: vi.fn()
  };
  const loginMutation = {
    mutateAsync: vi.fn()
  };
  const forgotPasswordMutation = {
    mutateAsync: vi.fn()
  };
  const otpRequestMutation = {
    mutateAsync: vi.fn()
  };
  const otpVerifyMutation = {
    mutateAsync: vi.fn()
  };

  const actions = useLoginActions({
    mode,
    email,
    password,
    confirmPassword,
    otpCode,
    showPassword,
    showConfirmPassword,
    emailTouched,
    passwordTouched,
    confirmPasswordTouched,
    otpCodeTouched,
    submitAttempted,
    errorMessage,
    infoMessage,
    rememberAccountOnDevice,
    rememberedAccount,
    useRememberedAccount,
    oauthCallbackInFlight,
    isRegister,
    isForgot,
    isOtp,
    showRememberedAccount,
    rememberedAccountDisplayName,
    canSubmit,
    surfacePaths,
    navigate,
    authStore,
    workspaceStore,
    registerMutation,
    loginMutation,
    forgotPasswordMutation,
    otpRequestMutation,
    otpVerifyMutation
  });

  return {
    mode,
    email,
    password,
    confirmPassword,
    otpCode,
    showPassword,
    showConfirmPassword,
    emailTouched,
    passwordTouched,
    confirmPasswordTouched,
    otpCodeTouched,
    submitAttempted,
    errorMessage,
    infoMessage,
    rememberAccountOnDevice,
    rememberedAccount,
    useRememberedAccount,
    oauthCallbackInFlight,
    isRegister,
    isForgot,
    isOtp,
    showRememberedAccount,
    rememberedAccountDisplayName,
    canSubmitFlag,
    surfacePaths,
    navigate,
    authStore,
    workspaceStore,
    registerMutation,
    loginMutation,
    forgotPasswordMutation,
    otpRequestMutation,
    otpVerifyMutation,
    actions
  };
}

describe("useLoginActions", () => {
  beforeEach(() => {
    mocks.api.bootstrap.mockReset();
    mocks.api.oauthComplete.mockReset();
    mocks.api.oauthStartUrl.mockReset();
    mocks.api.oauthStartUrl.mockImplementation((provider, { returnTo }) => `/api/oauth/${provider}/start?returnTo=${returnTo}`);

    mocks.oauthUtils.clearPendingOAuthContext.mockReset();
    mocks.oauthUtils.readOAuthCallbackStateFromLocation.mockReset();
    mocks.oauthUtils.readPendingOAuthContext.mockReset();
    mocks.oauthUtils.stripOAuthCallbackParamsFromLocation.mockReset();
    mocks.oauthUtils.writePendingOAuthContext.mockReset();

    mocks.storage.clearRememberedAccountHint.mockReset();
    mocks.storage.createRememberedAccountHint.mockReset();
    mocks.storage.createRememberedAccountHint.mockImplementation(({ displayName = "User" }) => ({
      displayName,
      maskedEmail: "m***@example.com",
      lastUsedAt: "2026-02-17T00:00:00.000Z"
    }));
    mocks.storage.readRememberedAccountHint.mockReset();
    mocks.storage.readRememberedAccountHint.mockReturnValue(null);
    mocks.storage.writeRememberedAccountHint.mockReset();

    mocks.recovery.hasRecoveryLinkPayload.mockReset();
    mocks.recovery.hasRecoveryLinkPayload.mockReturnValue(false);

    mocks.otpCallback.readOtpLoginCallbackStateFromLocation.mockReset();
    mocks.otpCallback.readOtpLoginCallbackStateFromLocation.mockReturnValue(null);
    mocks.otpCallback.stripOtpLoginCallbackParamsFromLocation.mockReset();

    mocks.errorMessage.toErrorMessage.mockReset();
    mocks.errorMessage.toErrorMessage.mockImplementation((error, fallback) => String(error?.message || fallback));
  });

  it("switches mode, resets validation/form state, and keeps remembered-account behavior scoped to login/otp", () => {
    const harness = createHarness();
    harness.actions.switchMode("login");
    expect(harness.mode.value).toBe("login");

    harness.actions.switchMode("register");
    expect(harness.mode.value).toBe("register");
    expect(harness.password.value).toBe("");
    expect(harness.confirmPassword.value).toBe("");
    expect(harness.otpCode.value).toBe("");
    expect(harness.showPassword.value).toBe(false);
    expect(harness.showConfirmPassword.value).toBe(false);
    expect(harness.errorMessage.value).toBe("");
    expect(harness.infoMessage.value).toBe("");
    expect(harness.useRememberedAccount.value).toBe(false);
    expect(harness.submitAttempted.value).toBe(false);
    expect(harness.emailTouched.value).toBe(false);

    harness.rememberedAccount.value = {
      displayName: "Chiara"
    };
    harness.actions.switchMode("otp");
    expect(harness.useRememberedAccount.value).toBe(true);
  });

  it("switches account by clearing stored hints and form state", () => {
    const harness = createHarness();
    harness.actions.switchAccount();
    expect(mocks.storage.clearRememberedAccountHint).toHaveBeenCalledTimes(1);
    expect(harness.rememberedAccount.value).toBe(null);
    expect(harness.useRememberedAccount.value).toBe(false);
    expect(harness.email.value).toBe("");
    expect(harness.password.value).toBe("");
    expect(harness.confirmPassword.value).toBe("");
    expect(harness.otpCode.value).toBe("");
    expect(harness.errorMessage.value).toBe("");
    expect(harness.infoMessage.value).toBe("");
  });

  it("builds provider labels/icons across login/register and remembered-account contexts", () => {
    const harness = createHarness();
    expect(harness.actions.oauthProviderButtonLabel({ label: "Google" })).toBe("Continue with Google as Tony");
    expect(harness.actions.oauthProviderIcon({ id: "google" })).toBe("$oauthGoogle");
    expect(harness.actions.oauthProviderIcon({ id: "other" })).toBeUndefined();

    harness.mode.value = "register";
    expect(harness.actions.oauthProviderButtonLabel({ label: "Google" })).toBe("Register with Google");

    harness.useRememberedAccount.value = false;
    harness.mode.value = "login";
    expect(harness.actions.oauthProviderButtonLabel({ label: "Google" })).toBe("Continue with Google");
  });

  it("starts oauth sign-in for supported providers and rejects unsupported providers", async () => {
    const harness = createHarness();
    await harness.actions.startOAuthSignIn("unsupported");
    expect(harness.errorMessage.value).toContain("not supported");

    const assign = vi.fn();
    const originalWindow = globalThis.window;
    vi.stubGlobal("window", {
      location: {
        assign
      }
    });
    try {
      await harness.actions.startOAuthSignIn("google");
      expect(mocks.oauthUtils.writePendingOAuthContext).toHaveBeenCalledWith({
        provider: "google",
        intent: "login",
        returnTo: "/",
        rememberAccountOnDevice: true
      });
      expect(assign).toHaveBeenCalledWith("/api/oauth/google/start?returnTo=/");
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });

  it("requests otp codes with validation, success, and error branches", async () => {
    const harness = createHarness();
    harness.email.value = "";
    await harness.actions.requestOtpCode();
    expect(harness.otpRequestMutation.mutateAsync).not.toHaveBeenCalled();

    harness.email.value = "user@example.com";
    harness.otpRequestMutation.mutateAsync.mockResolvedValue({
      message: "OTP sent."
    });
    await harness.actions.requestOtpCode();
    expect(harness.otpRequestMutation.mutateAsync).toHaveBeenCalledWith({
      email: "user@example.com"
    });
    expect(harness.infoMessage.value).toBe("OTP sent.");

    harness.otpRequestMutation.mutateAsync.mockRejectedValue(new Error("otp failed"));
    await harness.actions.requestOtpCode();
    expect(harness.errorMessage.value).toBe("otp failed");
  });

  it("runs forgot-password submit flow", async () => {
    const harness = createHarness({ initialMode: "forgot" });
    harness.forgotPasswordMutation.mutateAsync.mockResolvedValue({
      message: "Reset link sent."
    });
    await harness.actions.submitAuth();
    expect(harness.forgotPasswordMutation.mutateAsync).toHaveBeenCalledWith({
      email: "user@example.com"
    });
    expect(harness.mode.value).toBe("login");
    expect(harness.infoMessage.value).toBe("Reset link sent.");
  });

  it("handles register flow with and without email confirmation", async () => {
    const harness = createHarness({ initialMode: "register" });
    harness.registerMutation.mutateAsync.mockResolvedValue({
      requiresEmailConfirmation: true
    });
    await harness.actions.submitAuth();
    expect(harness.mode.value).toBe("login");
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.infoMessage.value).toContain("Confirm your email");

    harness.mode.value = "register";
    harness.registerMutation.mutateAsync.mockResolvedValue({
      requiresEmailConfirmation: false
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "Chiara"
      }
    });

    await harness.actions.submitAuth();
    expect(harness.authStore.applySession).toHaveBeenCalledWith({
      authenticated: true,
      username: "Chiara"
    });
    expect(harness.workspaceStore.applyBootstrap).toHaveBeenCalled();
    expect(mocks.storage.writeRememberedAccountHint).toHaveBeenCalled();
    expect(harness.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("submits otp/login auth flows and applies remembered-account preference", async () => {
    const otpHarness = createHarness({ initialMode: "otp" });
    otpHarness.otpCode.value = " 123456 ";
    otpHarness.otpVerifyMutation.mutateAsync.mockResolvedValue({
      ok: true
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "Tony"
      }
    });
    await otpHarness.actions.submitAuth();
    expect(otpHarness.otpVerifyMutation.mutateAsync).toHaveBeenCalledWith({
      email: "user@example.com",
      token: "123456"
    });
    expect(otpHarness.navigate).toHaveBeenCalledWith({ to: "/", replace: true });

    const loginHarness = createHarness();
    loginHarness.rememberAccountOnDevice.value = false;
    loginHarness.loginMutation.mutateAsync.mockResolvedValue({
      ok: true
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "Tony"
      }
    });
    await loginHarness.actions.submitAuth();
    expect(loginHarness.loginMutation.mutateAsync).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123"
    });
    expect(mocks.storage.clearRememberedAccountHint).toHaveBeenCalled();
  });

  it("short-circuits submit when canSubmit is false and surfaces submit errors", async () => {
    const blockedHarness = createHarness({ canSubmitInitial: false });
    await blockedHarness.actions.submitAuth();
    expect(blockedHarness.loginMutation.mutateAsync).not.toHaveBeenCalled();

    const failingHarness = createHarness();
    failingHarness.loginMutation.mutateAsync.mockRejectedValue(new Error("login failed"));
    await failingHarness.actions.submitAuth();
    expect(failingHarness.errorMessage.value).toBe("login failed");
  });

  it("redirects recovery links to reset page and stops initialization", async () => {
    const harness = createHarness();
    mocks.recovery.hasRecoveryLinkPayload.mockReturnValue(true);
    const originalWindow = globalThis.window;
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: {
        search: "?next=1",
        hash: "#token=abc",
        replace
      }
    });

    try {
      await harness.actions.initializeLoginView();
      expect(replace).toHaveBeenCalledWith("/reset-password?next=1#token=abc");
      expect(mocks.storage.readRememberedAccountHint).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });

  it("initializes with remembered hint and handles otp callback success and callback error", async () => {
    const harness = createHarness();
    mocks.storage.readRememberedAccountHint.mockReturnValue({
      displayName: "Tony",
      maskedEmail: "t***@example.com",
      lastUsedAt: "2026-02-17T00:00:00.000Z"
    });
    mocks.otpCallback.readOtpLoginCallbackStateFromLocation.mockReturnValue({
      tokenHash: "hash-token",
      type: "magiclink"
    });
    harness.otpVerifyMutation.mutateAsync.mockResolvedValue({
      email: "user@example.com",
      username: "Tony"
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "Tony"
      }
    });
    mocks.oauthUtils.readOAuthCallbackStateFromLocation.mockReturnValue(null);

    await harness.actions.initializeLoginView();

    expect(harness.oauthCallbackInFlight.value).toBe(false);
    expect(harness.otpVerifyMutation.mutateAsync).toHaveBeenCalledWith({
      tokenHash: "hash-token",
      type: "magiclink"
    });
    expect(mocks.otpCallback.stripOtpLoginCallbackParamsFromLocation).toHaveBeenCalled();
    expect(harness.navigate).toHaveBeenCalledWith({ to: "/", replace: true });

    const errorHarness = createHarness();
    mocks.otpCallback.readOtpLoginCallbackStateFromLocation.mockReturnValue({
      errorCode: "access_denied",
      errorDescription: "Denied by provider"
    });
    mocks.oauthUtils.readOAuthCallbackStateFromLocation.mockReturnValue(null);
    await errorHarness.actions.initializeLoginView();
    expect(errorHarness.errorMessage.value).toContain("Denied by provider");
  });

  it("handles oauth callback success and oauth callback failures", async () => {
    const successHarness = createHarness();
    mocks.oauthUtils.readPendingOAuthContext.mockReturnValue({
      rememberAccountOnDevice: false
    });
    mocks.oauthUtils.readOAuthCallbackStateFromLocation.mockReturnValue({
      payload: {
        provider: "google",
        accessToken: "token",
        refreshToken: "refresh"
      },
      intent: "login",
      returnTo: "/w/acme"
    });
    mocks.api.oauthComplete.mockResolvedValue({
      email: "user@example.com",
      username: "Tony"
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "Tony"
      }
    });
    await successHarness.actions.initializeLoginView();
    expect(mocks.api.oauthComplete).toHaveBeenCalled();
    expect(mocks.oauthUtils.stripOAuthCallbackParamsFromLocation).toHaveBeenCalled();
    expect(mocks.oauthUtils.clearPendingOAuthContext).toHaveBeenCalled();
    expect(successHarness.navigate).toHaveBeenCalledWith({ to: "/w/acme", replace: true });

    const failingHarness = createHarness();
    mocks.oauthUtils.readPendingOAuthContext.mockReturnValue({});
    mocks.oauthUtils.readOAuthCallbackStateFromLocation.mockReturnValue({
      payload: {
        provider: "google"
      },
      intent: "login",
      returnTo: "/"
    });
    mocks.api.oauthComplete.mockRejectedValue(new Error("oauth failed"));
    await failingHarness.actions.initializeLoginView();
    expect(failingHarness.errorMessage.value).toBe("oauth failed");
    expect(mocks.oauthUtils.stripOAuthCallbackParamsFromLocation).toHaveBeenCalled();
    expect(mocks.oauthUtils.clearPendingOAuthContext).toHaveBeenCalled();
  });

  it("handles callback bootstrap/session-not-active failures", async () => {
    const otpHarness = createHarness();
    mocks.otpCallback.readOtpLoginCallbackStateFromLocation.mockReturnValue({
      tokenHash: "hash-token",
      type: "magiclink"
    });
    otpHarness.otpVerifyMutation.mutateAsync.mockResolvedValue({
      email: "user@example.com",
      username: "Tony"
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: false
      }
    });
    mocks.oauthUtils.readOAuthCallbackStateFromLocation.mockReturnValue(null);

    await otpHarness.actions.initializeLoginView();
    expect(otpHarness.errorMessage.value).toContain("session is not active");
  });
});
