import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const appInstance = {
    use: vi.fn(),
    mount: vi.fn()
  };
  appInstance.use.mockReturnValue(appInstance);

  return {
    appInstance,
    createApp: vi.fn(() => appInstance),
    h: vi.fn(() => ({ vnode: true })),
    createPinia: vi.fn(() => ({ pinia: true })),
    createVuetify: vi.fn(() => ({ vuetify: true })),
    useAuthStore: vi.fn(() => ({ authenticated: false })),
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
    mocks.createAppRouter.mockClear();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("initializes pinia, router, vuetify, query plugin, and mounts app", async () => {
    await import("../../src/main.js");

    expect(mocks.createPinia).toHaveBeenCalledTimes(1);
    const pinia = mocks.createPinia.mock.results[0].value;
    expect(mocks.useAuthStore).toHaveBeenCalledWith(pinia);
    expect(mocks.createAppRouter).toHaveBeenCalledWith({ authenticated: false });

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
    expect(mocks.appInstance.use).toHaveBeenNthCalledWith(3, { vuetify: true });
    expect(mocks.appInstance.mount).toHaveBeenCalledWith("#app");
  });
});
