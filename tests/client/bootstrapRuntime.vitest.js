import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  h: vi.fn(),
  createPinia: vi.fn(),
  createVuetify: vi.fn(),
  authStoreFactory: vi.fn(),
  workspaceStoreFactory: vi.fn(),
  installBrowserErrorReporter: vi.fn(),
  createRealtimeRuntime: vi.fn(),
  realtimeRuntime: {
    start: vi.fn(),
    stop: vi.fn()
  },
  bootstrapApi: vi.fn(),
  queryClient: {
    marker: "query-client"
  },
  vueQueryPlugin: {
    marker: "vue-query-plugin"
  },
  routerProvider: {
    marker: "router-provider"
  },
  createdPinia: {
    marker: "pinia"
  },
  createdVuetify: {
    theme: {
      global: {
        name: {
          value: "light"
        }
      }
    }
  },
  appInstance: {
    use: vi.fn(),
    mount: vi.fn()
  },
  authStore: {
    applySession: vi.fn(),
    setSignedOut: vi.fn(),
    isAuthenticated: false
  },
  consoleStoreFactory: vi.fn(),
  consoleStore: {
    refreshBootstrap: vi.fn(),
    clearConsoleState: vi.fn(),
    setForbidden: vi.fn()
  },
  workspaceStore: {
    userSettings: null,
    applyBootstrap: vi.fn(),
    clearWorkspaceState: vi.fn()
  }
}));

vi.mock("vue", () => ({
  createApp: (...args) => mocks.createApp(...args),
  h: (...args) => mocks.h(...args)
}));

vi.mock("pinia", () => ({
  createPinia: () => mocks.createPinia()
}));

vi.mock("@tanstack/vue-query", () => ({
  VueQueryPlugin: mocks.vueQueryPlugin
}));

vi.mock("@tanstack/vue-router", () => ({
  RouterProvider: mocks.routerProvider
}));

vi.mock("vuetify", () => ({
  createVuetify: () => mocks.createVuetify()
}));

vi.mock("vuetify/iconsets/mdi-svg", () => ({
  aliases: {},
  mdi: {}
}));

vi.mock("@mdi/js", () => ({
  mdiAccountMultipleOutline: "mdi-account-multiple-outline",
  mdiAlertCircleOutline: "mdi-alert-circle-outline",
  mdiArrowLeftTopBold: "mdi-arrow-left-top-bold",
  mdiAccountOutline: "mdi-account-outline",
  mdiCogOutline: "mdi-cog-outline",
  mdiGoogle: "mdi-google",
  mdiHelpCircleOutline: "mdi-help-circle-outline",
  mdiHomeOutline: "mdi-home-outline",
  mdiLogout: "mdi-logout",
  mdiMessageTextOutline: "mdi-message-text-outline",
  mdiServer: "mdi-server",
  mdiShieldCrownOutline: "mdi-shield-crown-outline",
  mdiShapeOutline: "mdi-shape-outline",
  mdiViewDashboardOutline: "mdi-view-dashboard-outline"
}));

vi.mock("vuetify/styles", () => ({}));

vi.mock("../../src/queryClient", () => ({
  queryClient: mocks.queryClient
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: {
    workspace: {
      bootstrap: mocks.bootstrapApi
    }
  }
}));

vi.mock("../../src/services/browserErrorReporter.js", () => ({
  installBrowserErrorReporter: mocks.installBrowserErrorReporter
}));

vi.mock("../../src/services/realtime/realtimeRuntime.js", () => ({
  createRealtimeRuntime: (...args) => mocks.createRealtimeRuntime(...args)
}));

vi.mock("../../src/stores/authStore", () => ({
  useAuthStore: (pinia) => mocks.authStoreFactory(pinia)
}));

vi.mock("../../src/stores/workspaceStore", () => ({
  useWorkspaceStore: (pinia) => mocks.workspaceStoreFactory(pinia)
}));

vi.mock("../../src/stores/consoleStore", () => ({
  useConsoleStore: (pinia) => mocks.consoleStoreFactory(pinia)
}));

import { mountSurfaceApplication } from "../../src/bootstrapRuntime.js";

describe("bootstrapRuntime", () => {
  beforeEach(() => {
    mocks.createPinia.mockReset();
    mocks.createVuetify.mockReset();
    mocks.createApp.mockReset();
    mocks.h.mockReset();
    mocks.authStoreFactory.mockReset();
    mocks.workspaceStoreFactory.mockReset();
    mocks.bootstrapApi.mockReset();
    mocks.installBrowserErrorReporter.mockReset();
    mocks.createRealtimeRuntime.mockReset();
    mocks.realtimeRuntime.start.mockReset();
    mocks.realtimeRuntime.stop.mockReset();

    mocks.appInstance.use.mockReset();
    mocks.appInstance.mount.mockReset();
    mocks.appInstance.use.mockReturnValue(mocks.appInstance);

    mocks.authStore.applySession.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.isAuthenticated = false;
    mocks.authStore.applySession.mockImplementation(({ authenticated }) => {
      mocks.authStore.isAuthenticated = Boolean(authenticated);
    });

    mocks.consoleStoreFactory.mockReset();
    mocks.consoleStore.refreshBootstrap.mockReset();
    mocks.consoleStore.clearConsoleState.mockReset();
    mocks.consoleStore.setForbidden.mockReset();
    mocks.consoleStoreFactory.mockReturnValue(mocks.consoleStore);

    mocks.workspaceStore.userSettings = null;
    mocks.workspaceStore.applyBootstrap.mockReset();
    mocks.workspaceStore.clearWorkspaceState.mockReset();
    mocks.workspaceStore.applyBootstrap.mockImplementation((payload) => {
      mocks.workspaceStore.userSettings = payload?.userSettings || null;
    });

    mocks.createPinia.mockReturnValue(mocks.createdPinia);
    mocks.createVuetify.mockImplementation(() => ({
      theme: {
        global: {
          name: {
            value: "light"
          }
        }
      }
    }));
    mocks.createApp.mockReturnValue(mocks.appInstance);

    mocks.authStoreFactory.mockReturnValue(mocks.authStore);
    mocks.workspaceStoreFactory.mockReturnValue(mocks.workspaceStore);
    mocks.createRealtimeRuntime.mockReturnValue(mocks.realtimeRuntime);

    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
  });

  it("mounts app and applies dark theme preference from bootstrap", async () => {
    const createRouter = vi.fn(() => ({ id: "router-1" }));
    mocks.bootstrapApi.mockResolvedValue({
      session: {
        authenticated: true,
        username: "tony"
      },
      userSettings: {
        theme: "dark"
      }
    });

    await mountSurfaceApplication({ createRouter });

    expect(mocks.createPinia).toHaveBeenCalledTimes(1);
    expect(mocks.installBrowserErrorReporter).toHaveBeenCalledTimes(1);
    expect(mocks.authStoreFactory).toHaveBeenCalledWith(mocks.createdPinia);
    expect(mocks.consoleStoreFactory).toHaveBeenCalledWith(mocks.createdPinia);
    expect(mocks.workspaceStoreFactory).toHaveBeenCalledWith(mocks.createdPinia);
    expect(mocks.authStore.applySession).toHaveBeenCalledWith({
      authenticated: true,
      username: "tony"
    });
    expect(mocks.workspaceStore.applyBootstrap).toHaveBeenCalledTimes(1);

    const vuetifyInstance = mocks.createVuetify.mock.results[0].value;
    expect(vuetifyInstance.theme.global.name.value).toBe("dark");

    expect(createRouter).toHaveBeenCalledWith({
      authStore: mocks.authStore,
      workspaceStore: mocks.workspaceStore,
      consoleStore: mocks.consoleStore
    });
    expect(mocks.createRealtimeRuntime).toHaveBeenCalledWith({
      authStore: mocks.authStore,
      workspaceStore: mocks.workspaceStore,
      queryClient: mocks.queryClient,
      surface: undefined
    });
    expect(mocks.realtimeRuntime.start).toHaveBeenCalledTimes(1);

    expect(mocks.createApp).toHaveBeenCalledTimes(1);
    expect(mocks.appInstance.use).toHaveBeenNthCalledWith(1, mocks.createdPinia);
    expect(mocks.appInstance.use).toHaveBeenNthCalledWith(2, mocks.vueQueryPlugin, {
      queryClient: mocks.queryClient
    });
    expect(mocks.appInstance.use).toHaveBeenNthCalledWith(3, vuetifyInstance);
    expect(mocks.appInstance.mount).toHaveBeenCalledWith("#app");

    const appConfig = mocks.createApp.mock.calls[0][0];
    appConfig.render();
    expect(mocks.h).toHaveBeenCalledWith(mocks.routerProvider, {
      router: { id: "router-1" }
    });
  });

  it("applies light theme preference from bootstrap", async () => {
    const createRouter = vi.fn(() => ({ id: "router-2" }));
    mocks.bootstrapApi.mockResolvedValue({
      session: {
        authenticated: true,
        username: null
      },
      userSettings: {
        theme: "light"
      }
    });

    await mountSurfaceApplication({ createRouter });

    const vuetifyInstance = mocks.createVuetify.mock.results[0].value;
    expect(vuetifyInstance.theme.global.name.value).toBe("light");
    expect(mocks.authStore.applySession).toHaveBeenCalledWith({
      authenticated: true,
      username: null
    });
  });

  it("falls back to signed-out flow and system dark preference on bootstrap failure", async () => {
    const createRouter = vi.fn(() => ({ id: "router-3" }));
    mocks.bootstrapApi.mockRejectedValue(new Error("bootstrap failed"));
    window.matchMedia = vi.fn(() => ({
      matches: true,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    await mountSurfaceApplication({ createRouter });

    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.consoleStore.clearConsoleState).toHaveBeenCalledTimes(1);

    const vuetifyInstance = mocks.createVuetify.mock.results[0].value;
    expect(vuetifyInstance.theme.global.name.value).toBe("dark");
  });

  it("uses system fallback with light preference when matchMedia is unavailable", async () => {
    const createRouter = vi.fn(() => ({ id: "router-4" }));
    mocks.bootstrapApi.mockResolvedValue({
      session: {
        authenticated: true,
        username: "sam"
      },
      userSettings: {
        theme: ""
      }
    });

    window.matchMedia = undefined;
    await mountSurfaceApplication({ createRouter });

    const vuetifyInstance = mocks.createVuetify.mock.results[0].value;
    expect(vuetifyInstance.theme.global.name.value).toBe("light");
  });

  it("refreshes console bootstrap when mounting console surface with authenticated session", async () => {
    const createRouter = vi.fn(() => ({ id: "router-5" }));
    mocks.bootstrapApi.mockResolvedValue({
      session: {
        authenticated: true,
        username: "zeus"
      },
      userSettings: {
        theme: "dark"
      }
    });

    await mountSurfaceApplication({ createRouter, surface: "console" });

    expect(mocks.consoleStore.refreshBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.consoleStore.clearConsoleState).not.toHaveBeenCalled();
  });
});
