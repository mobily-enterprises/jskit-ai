import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: {
    register: vi.fn(),
    login: vi.fn(),
    requestPasswordReset: vi.fn()
  },
  authStore: {
    refreshSession: vi.fn(),
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

import LoginView from "../../src/views/LoginView.vue";

function mountView() {
  return mount(LoginView, {
    global: {
      stubs: {
        "v-app": true,
        "v-main": true,
        "v-container": true,
        "v-row": true,
        "v-col": true,
        "v-card": true,
        "v-card-text": true,
        "v-form": true,
        "v-text-field": true,
        "v-btn": true,
        "v-alert": true,
        "v-chip": true
      }
    }
  });
}

describe("LoginView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.api.register.mockReset();
    mocks.api.login.mockReset();
    mocks.api.requestPasswordReset.mockReset();
    mocks.authStore.refreshSession.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.invalidateSession.mockReset();
    window.history.replaceState({}, "", "/login");
  });

  it("switches modes and updates headings", async () => {
    const wrapper = mountView();

    expect(wrapper.vm.authTitle).toBe("Sign in to continue");
    wrapper.vm.switchMode("register");
    await nextTick();
    expect(wrapper.vm.authTitle).toBe("Register to continue");

    wrapper.vm.switchMode("forgot");
    await nextTick();
    expect(wrapper.vm.authTitle).toBe("Reset your password");
  });

  it("submits login and navigates to calculator when session becomes authenticated", async () => {
    mocks.api.login.mockResolvedValue({ ok: true, username: "demo-user" });
    mocks.authStore.refreshSession.mockResolvedValue({ authenticated: true });

    const wrapper = mountView();
    wrapper.vm.email = "User@Example.com";
    wrapper.vm.password = "password123";

    await wrapper.vm.submitAuth();

    expect(mocks.api.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123"
    });
    expect(mocks.authStore.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("submits forgot-password flow and shows returned info message", async () => {
    mocks.api.requestPasswordReset.mockResolvedValue({
      message: "If an account exists for that email, a password reset link has been sent."
    });

    const wrapper = mountView();
    wrapper.vm.switchMode("forgot");
    wrapper.vm.email = "forgot@example.com";

    await wrapper.vm.submitAuth();

    expect(mocks.api.requestPasswordReset).toHaveBeenCalledWith({
      email: "forgot@example.com"
    });
    expect(wrapper.vm.infoMessage).toContain("password reset link has been sent");
  });

  it("submits register flow that requires email confirmation", async () => {
    mocks.api.register.mockResolvedValue({
      requiresEmailConfirmation: true
    });

    const wrapper = mountView();
    wrapper.vm.switchMode("register");
    wrapper.vm.email = "new-user@example.com";
    wrapper.vm.password = "password123";
    wrapper.vm.confirmPassword = "password123";

    await wrapper.vm.submitAuth();

    expect(mocks.api.register).toHaveBeenCalledWith({
      email: "new-user@example.com",
      password: "password123"
    });
    expect(mocks.authStore.refreshSession).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(wrapper.vm.infoMessage).toContain("Confirm your email");
  });
});
