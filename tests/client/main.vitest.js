import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const appInstance = {
    use: vi.fn(),
    mount: vi.fn()
  };
  appInstance.use.mockReturnValue(appInstance);
  const vuetifyInstance = {
    vuetify: true,
    theme: {
      global: {
        name: {
          value: "light"
        }
      }
    }
  };
  const authStoreInstance = {
    initialized: false,
    isAuthenticated: false,
    applySession: vi.fn(),
    setSignedOut: vi.fn()
  };
  const workspaceStoreInstance = {
    initialized: false,
    userSettings: {
      theme: "system"
    },
    applyBootstrap: vi.fn(),
    clearWorkspaceState: vi.fn()
  };

  return {
    appInstance,
    createApp: vi.fn(() => appInstance),
    h: vi.fn(() => ({ vnode: true })),
    createPinia: vi.fn(() => ({ pinia: true })),
    vuetifyInstance,
    createVuetify: vi.fn(() => vuetifyInstance),
    authStoreInstance,
    workspaceStoreInstance,
    useAuthStore: vi.fn(() => authStoreInstance),
    useWorkspaceStore: vi.fn(() => workspaceStoreInstance),
    api: {
      bootstrap: vi.fn(async () => ({ session: { authenticated: false, username: null } }))
    },
    createAppRouter: vi.fn(() => ({ router: true })),
    queryClient: { id: "query-client" },
    VueQueryPlugin: { id: "vue-query-plugin" },
    RouterProvider: { id: "router-provider" },
    mdiAliases: { eye: "mdi-eye" },
    mdiSet: { component: {} }
  };
});

vi.mock("vue", () => ({
  createApp: mocks.createApp,
  h: mocks.h
}));

vi.mock("pinia", () => ({
  createPinia: mocks.createPinia
}));

vi.mock("@tanstack/vue-query", () => ({
  VueQueryPlugin: mocks.VueQueryPlugin
}));

vi.mock("@tanstack/vue-router", () => ({
  RouterProvider: mocks.RouterProvider
}));

vi.mock("vuetify", () => ({
  createVuetify: mocks.createVuetify
}));

vi.mock("vuetify/iconsets/mdi-svg", () => ({
  aliases: mocks.mdiAliases,
  mdi: mocks.mdiSet
}));
vi.mock("vuetify/styles", () => ({}));

vi.mock("../../src/queryClient.js", () => ({
  queryClient: mocks.queryClient
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: mocks.useAuthStore
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: mocks.useWorkspaceStore
}));

vi.mock("../../src/services/api.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/router.js", () => ({
  createAppRouter: mocks.createAppRouter
}));

describe("main bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.appInstance.use.mockClear();
    mocks.appInstance.mount.mockClear();
    mocks.createApp.mockClear();
    mocks.h.mockClear();
    mocks.createPinia.mockClear();
    mocks.createVuetify.mockClear();
    mocks.useAuthStore.mockClear();
    mocks.useWorkspaceStore.mockClear();
    mocks.api.bootstrap.mockClear();
    mocks.authStoreInstance.applySession.mockClear();
    mocks.authStoreInstance.setSignedOut.mockClear();
    mocks.workspaceStoreInstance.applyBootstrap.mockClear();
    mocks.workspaceStoreInstance.clearWorkspaceState.mockClear();
    mocks.workspaceStoreInstance.userSettings = {
      theme: "system"
    };
    mocks.vuetifyInstance.theme.global.name.value = "light";
    mocks.createAppRouter.mockClear();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("initializes pinia, router, vuetify, query plugin, and mounts app", async () => {
    await import("../../src/main.js");

    expect(mocks.createPinia).toHaveBeenCalledTimes(1);
    const pinia = mocks.createPinia.mock.results[0].value;
    expect(mocks.useAuthStore).toHaveBeenCalledWith(pinia);
    expect(mocks.useWorkspaceStore).toHaveBeenCalledWith(pinia);
    expect(mocks.api.bootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.authStoreInstance.applySession).toHaveBeenCalledWith({
      authenticated: false,
      username: null
    });
    expect(mocks.workspaceStoreInstance.applyBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.createAppRouter).toHaveBeenCalledWith({
      authStore: mocks.authStoreInstance,
      workspaceStore: mocks.workspaceStoreInstance
    });

    expect(mocks.createVuetify).toHaveBeenCalledTimes(1);
    expect(mocks.createVuetify).toHaveBeenCalledWith(
      expect.objectContaining({
        icons: {
          defaultSet: "mdi",
          aliases: expect.objectContaining(mocks.mdiAliases),
          sets: {
            mdi: mocks.mdiSet
          }
        }
      })
    );
    expect(mocks.createApp).toHaveBeenCalledTimes(1);

    const rootComponent = mocks.createApp.mock.calls[0][0];
    rootComponent.render();

    expect(mocks.h).toHaveBeenCalledWith(mocks.RouterProvider, {
      router: { router: true }
    });

    expect(mocks.appInstance.use).toHaveBeenNthCalledWith(1, pinia);
    expect(mocks.appInstance.use).toHaveBeenNthCalledWith(2, mocks.VueQueryPlugin, {
      queryClient: mocks.queryClient
    });
    expect(mocks.appInstance.use).toHaveBeenNthCalledWith(3, mocks.vuetifyInstance);
    expect(mocks.appInstance.mount).toHaveBeenCalledWith("#app");
  });
});
