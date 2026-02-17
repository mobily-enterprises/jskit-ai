import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  api: {
    completePasswordRecovery: vi.fn(),
    resetPassword: vi.fn()
  },
  authStore: {
    refreshSession: vi.fn(),
    ensureSession: vi.fn(),
    setSignedOut: vi.fn(),
    invalidateSession: vi.fn(async () => undefined)
  }
}));

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock("@tanstack/vue-query", () => ({
  useMutation: ({ mutationFn }) => ({
    isPending: ref(false),
    mutateAsync: (payload) => mutationFn(payload)
  })
}));

vi.mock("../../src/services/api.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

import { useResetPasswordView } from "../../src/views/reset-password/useResetPasswordView.js";

function mountHarness() {
  const Harness = defineComponent({
    name: "ResetPasswordLogicHarness",
    setup() {
      return {
        vm: useResetPasswordView()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

async function flushAll() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("useResetPasswordView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();

    mocks.api.completePasswordRecovery.mockReset();
    mocks.api.resetPassword.mockReset();

    mocks.authStore.refreshSession.mockReset();
    mocks.authStore.ensureSession.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.invalidateSession.mockReset();
    mocks.authStore.invalidateSession.mockResolvedValue(undefined);

    window.history.replaceState({}, "", "/reset-password");
  });

  it("handles missing recovery payload by forcing session check and mapping unauthenticated state", async () => {
    mocks.authStore.ensureSession.mockResolvedValue({
      authenticated: false
    });

    const wrapper = mountHarness();
    await flushAll();

    expect(mocks.authStore.ensureSession).toHaveBeenCalledWith({ force: true });
    expect(wrapper.vm.vm.status.readyForPasswordUpdate).toBe(false);
    expect(wrapper.vm.vm.status.recoveryError).toContain("missing or expired");
  });

  it("accepts existing authenticated session when no recovery payload is present", async () => {
    mocks.authStore.ensureSession.mockResolvedValue({
      authenticated: true
    });

    const wrapper = mountHarness();
    await flushAll();

    expect(wrapper.vm.vm.status.readyForPasswordUpdate).toBe(true);
    expect(wrapper.vm.vm.status.recoveryError).toBe("");
  });

  it("surfaces link-error description from query/hash without calling recovery endpoint", async () => {
    window.history.replaceState({}, "", "/reset-password?error_description=Recovery%20expired");

    const wrapper = mountHarness();
    await flushAll();

    expect(mocks.api.completePasswordRecovery).not.toHaveBeenCalled();
    expect(wrapper.vm.vm.status.recoveryError).toBe("Recovery expired");
    expect(wrapper.vm.vm.status.initializing).toBe(false);
  });

  it("completes recovery using auth code payload", async () => {
    window.history.replaceState({}, "", "/reset-password?code=abc123");
    mocks.api.completePasswordRecovery.mockResolvedValue({ ok: true });
    mocks.authStore.refreshSession.mockResolvedValue({
      authenticated: true
    });

    const wrapper = mountHarness();
    await flushAll();

    expect(mocks.api.completePasswordRecovery).toHaveBeenCalledWith({
      code: "abc123"
    });
    expect(wrapper.vm.vm.status.readyForPasswordUpdate).toBe(true);
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("");
  });

  it("completes recovery using token hash payload", async () => {
    window.history.replaceState({}, "", "/reset-password#token_hash=hash-token");
    mocks.api.completePasswordRecovery.mockResolvedValue({ ok: true });
    mocks.authStore.refreshSession.mockResolvedValue({
      authenticated: true
    });

    mountHarness();
    await flushAll();

    expect(mocks.api.completePasswordRecovery).toHaveBeenCalledWith({
      tokenHash: "hash-token",
      type: "recovery"
    });
  });

  it("completes recovery using access/refresh token payload from hash", async () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password#access_token=access-token&refresh_token=refresh-token&token_type=bearer"
    );
    mocks.api.completePasswordRecovery.mockResolvedValue({ ok: true });
    mocks.authStore.refreshSession.mockResolvedValue({
      authenticated: true
    });

    mountHarness();
    await flushAll();

    expect(mocks.api.completePasswordRecovery).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      type: "recovery"
    });
  });

  it("maps recovery endpoint failures and inactive refreshed sessions", async () => {
    window.history.replaceState({}, "", "/reset-password?code=abc123");
    mocks.api.completePasswordRecovery.mockResolvedValue({ ok: true });
    mocks.authStore.refreshSession.mockResolvedValue({
      authenticated: false
    });

    const wrapper = mountHarness();
    await flushAll();

    expect(wrapper.vm.vm.status.recoveryError).toContain("Unable to establish a recovery session");

    window.history.replaceState({}, "", "/reset-password?code=abc123");
    mocks.api.completePasswordRecovery.mockRejectedValueOnce({
      fieldErrors: {
        code: "Code is invalid.",
        token: "Token is expired."
      }
    });
    const secondWrapper = mountHarness();
    await flushAll();
    expect(secondWrapper.vm.vm.status.recoveryError).toContain("Code is invalid. Token is expired.");
  });

  it("guards submit when validation fails and submits successful password reset", async () => {
    mocks.authStore.ensureSession.mockResolvedValue({
      authenticated: true
    });
    mocks.api.resetPassword.mockResolvedValue({
      message: "Password updated."
    });

    const wrapper = mountHarness();
    await flushAll();

    wrapper.vm.vm.form.password = "";
    wrapper.vm.vm.form.confirmPassword = "";
    await wrapper.vm.vm.actions.submitPasswordReset();
    expect(mocks.api.resetPassword).not.toHaveBeenCalled();

    wrapper.vm.vm.form.password = "new-password-123";
    wrapper.vm.vm.form.confirmPassword = "new-password-123";
    await wrapper.vm.vm.actions.submitPasswordReset();

    expect(mocks.api.resetPassword).toHaveBeenCalledWith({
      password: "new-password-123"
    });
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.status.formSuccess).toContain("Password updated");
    expect(wrapper.vm.vm.status.readyForPasswordUpdate).toBe(false);
  });

  it("derives validation message visibility from touched/submit state", async () => {
    mocks.authStore.ensureSession.mockResolvedValue({
      authenticated: true
    });
    const wrapper = mountHarness();
    await flushAll();

    wrapper.vm.vm.form.password = "";
    wrapper.vm.vm.form.confirmPassword = "";
    wrapper.vm.vm.form.passwordTouched = false;
    wrapper.vm.vm.form.confirmPasswordTouched = false;
    expect(wrapper.vm.vm.validation.passwordErrorMessages).toEqual([]);
    expect(wrapper.vm.vm.validation.confirmPasswordErrorMessages).toEqual([]);

    wrapper.vm.vm.form.passwordTouched = true;
    wrapper.vm.vm.form.confirmPasswordTouched = true;
    expect(wrapper.vm.vm.validation.passwordErrorMessages.length).toBeGreaterThan(0);
    expect(wrapper.vm.vm.validation.confirmPasswordErrorMessages.length).toBeGreaterThan(0);

    wrapper.vm.vm.status.readyForPasswordUpdate = false;
    expect(wrapper.vm.vm.validation.canSubmit).toBe(false);
  });

  it("maps reset-password submission errors and navigates back to login", async () => {
    mocks.authStore.ensureSession.mockResolvedValue({
      authenticated: true
    });
    const wrapper = mountHarness();
    await flushAll();

    wrapper.vm.vm.form.password = "new-password-123";
    wrapper.vm.vm.form.confirmPassword = "new-password-123";

    mocks.api.resetPassword.mockRejectedValue({
      fieldErrors: {
        password: "Password is too weak."
      }
    });

    await wrapper.vm.vm.actions.submitPasswordReset();
    expect(wrapper.vm.vm.status.formError).toContain("Password is too weak.");

    await wrapper.vm.vm.actions.goToLogin();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/login",
      replace: true
    });
  });
});
