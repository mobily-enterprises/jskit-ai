import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: {
    completePasswordRecovery: vi.fn(),
    resetPassword: vi.fn()
  },
  authStore: {
    refreshSession: vi.fn(),
    ensureSession: vi.fn(),
    setSignedOut: vi.fn(),
    invalidateSession: vi.fn()
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

import ResetPasswordView from "../../src/views/ResetPasswordView.vue";

function mountView() {
  return mount(ResetPasswordView, {
    global: {
      stubs: {
        "v-app": true,
        "v-main": true,
        "v-container": true,
        "v-card": true,
        "v-card-text": true,
        "v-progress-circular": true,
        "v-alert": true,
        "v-form": true,
        "v-text-field": true,
        "v-btn": true
      }
    }
  });
}

async function flushTicks() {
  await Promise.resolve();
  await nextTick();
}

describe("ResetPasswordView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.api.completePasswordRecovery.mockReset();
    mocks.api.resetPassword.mockReset();
    mocks.authStore.refreshSession.mockReset();
    mocks.authStore.ensureSession.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.invalidateSession.mockReset();
    window.history.replaceState({}, "", "/reset-password");
  });

  it("shows recovery error when no valid link/session is available", async () => {
    mocks.authStore.ensureSession.mockResolvedValue({ authenticated: false });

    const wrapper = mountView();
    await flushTicks();
    await flushTicks();

    expect(mocks.authStore.ensureSession).toHaveBeenCalledWith({ force: true });
    expect(wrapper.vm.recoveryError).toContain("Recovery link is missing or expired");
  });

  it("completes recovery from token payload and resets password", async () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password#access_token=access-token&refresh_token=refresh-token&type=recovery"
    );
    mocks.api.completePasswordRecovery.mockResolvedValue({ ok: true });
    mocks.authStore.refreshSession.mockResolvedValue({ authenticated: true });
    mocks.api.resetPassword.mockResolvedValue({ message: "Password updated." });
    mocks.authStore.invalidateSession.mockResolvedValue(undefined);

    const wrapper = mountView();
    await flushTicks();
    await flushTicks();

    expect(mocks.api.completePasswordRecovery).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      type: "recovery"
    });

    wrapper.vm.password = "newpassword123";
    wrapper.vm.confirmPassword = "newpassword123";

    await wrapper.vm.submitPasswordReset();

    expect(mocks.api.resetPassword).toHaveBeenCalledWith({
      password: "newpassword123"
    });
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.formSuccess).toContain("Password");
  });
});
