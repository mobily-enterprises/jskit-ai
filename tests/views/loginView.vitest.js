import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: {
    register: vi.fn(),
    login: vi.fn(),
    requestPasswordReset: vi.fn(),
    requestOtpLogin: vi.fn(),
    verifyOtpLogin: vi.fn(),
    oauthComplete: vi.fn(),
    bootstrap: vi.fn(),
    oauthStartUrl: vi.fn((provider) => `/api/oauth/${provider}/start`)
  },
  authStore: {
    applySession: vi.fn()
  },
  workspaceStore: {
    applyBootstrap: vi.fn(),
    clearWorkspaceState: vi.fn()
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

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

import LoginView from "../../src/views/login/LoginView.vue";

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
        "v-checkbox": true,
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
    mocks.api.requestOtpLogin.mockReset();
    mocks.api.verifyOtpLogin.mockReset();
    mocks.api.oauthComplete.mockReset();
    mocks.api.bootstrap.mockReset();
    mocks.api.oauthStartUrl.mockClear();
    mocks.authStore.applySession.mockReset();
    mocks.workspaceStore.applyBootstrap.mockReset();
    mocks.workspaceStore.clearWorkspaceState.mockReset();
    window.history.replaceState({}, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("switches modes and updates headings", async () => {
    const wrapper = mountView();

    expect(wrapper.vm.authTitle).toBe("Sign in");
    wrapper.vm.switchMode("register");
    await nextTick();
    expect(wrapper.vm.authTitle).toBe("Register to continue");

    wrapper.vm.switchMode("forgot");
    await nextTick();
    expect(wrapper.vm.authTitle).toBe("Reset your password");
  });

  it("submits login and navigates to calculator when session becomes authenticated", async () => {
    mocks.api.login.mockResolvedValue({ ok: true, username: "demo-user" });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "demo-user"
      }
    });

    const wrapper = mountView();
    wrapper.vm.email = "User@Example.com";
    wrapper.vm.password = "password123";

    await wrapper.vm.submitAuth();

    expect(mocks.api.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123"
    });
    expect(mocks.authStore.applySession).toHaveBeenCalledWith({
      authenticated: true,
      username: "demo-user"
    });
    expect(mocks.workspaceStore.applyBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("loads remembered account hint and lets user switch accounts", async () => {
    window.localStorage.setItem(
      "auth.rememberedAccount",
      JSON.stringify({
        email: "tony@example.com",
        displayName: "Tony",
        lastUsedAt: "2026-02-16T00:00:00.000Z"
      })
    );

    const wrapper = mountView();
    await nextTick();

    expect(wrapper.vm.showRememberedAccount).toBe(true);
    expect(wrapper.vm.email).toBe("");
    expect(wrapper.vm.rememberedAccountMaskedEmail).toBe("t***@example.com");
    expect(wrapper.vm.rememberedAccountSwitchLabel).toBe("Not Tony?");

    wrapper.vm.switchAccount();
    await nextTick();

    expect(wrapper.vm.showRememberedAccount).toBe(false);
    expect(wrapper.vm.email).toBe("");
    expect(window.localStorage.getItem("auth.rememberedAccount")).toBe(null);
  });

  it("stores remembered account on successful login and clears it when remember is disabled", async () => {
    mocks.api.login.mockResolvedValue({ ok: true, username: "tony" });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "tony"
      }
    });

    const wrapper = mountView();
    wrapper.vm.email = "tony@example.com";
    wrapper.vm.password = "password123";
    wrapper.vm.rememberAccountOnDevice = true;

    await wrapper.vm.submitAuth();

    const remembered = JSON.parse(window.localStorage.getItem("auth.rememberedAccount"));
    expect(remembered.email).toBe(undefined);
    expect(remembered.maskedEmail).toBe("t***@example.com");
    expect(remembered.displayName).toBe("tony");

    wrapper.vm.rememberAccountOnDevice = false;
    wrapper.vm.email = "tony@example.com";
    wrapper.vm.password = "password123";
    await wrapper.vm.submitAuth();

    expect(window.localStorage.getItem("auth.rememberedAccount")).toBe(null);
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
    expect(mocks.api.bootstrap).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(wrapper.vm.infoMessage).toContain("Confirm your email");
  });

  it("completes OAuth callback when Supabase returns hash access tokens", async () => {
    window.history.replaceState(
      {},
      "",
      "/login?oauthProvider=google#access_token=access-token&refresh_token=refresh-token&token_type=bearer"
    );
    mocks.api.oauthComplete.mockResolvedValue({
      ok: true,
      provider: "google",
      username: "tony",
      email: "tony@example.com"
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "tony"
      }
    });

    mountView();
    await vi.waitFor(() => {
      expect(mocks.api.oauthComplete).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    });

    expect(mocks.api.oauthComplete).toHaveBeenCalledWith({
      provider: "google",
      accessToken: "access-token",
      refreshToken: "refresh-token"
    });

    const remembered = JSON.parse(window.localStorage.getItem("auth.rememberedAccount"));
    expect(remembered.maskedEmail).toBe("t***@example.com");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });
});
