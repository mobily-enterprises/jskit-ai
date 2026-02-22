import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSurfaceRouter: vi.fn(),
  appShell: {
    name: "AppShellStub"
  }
}));

vi.mock("../../src/routerFactory.js", () => ({
  createSurfaceRouter: (...args) => mocks.createSurfaceRouter(...args)
}));

vi.mock("../../src/shells/app/AppShell.vue", () => ({
  default: mocks.appShell
}));

import { createAppRouter } from "../../src/router.app.js";

describe("createAppRouter", () => {
  beforeEach(() => {
    mocks.createSurfaceRouter.mockReset();
    mocks.createSurfaceRouter.mockReturnValue({ marker: "app-router" });
  });

  it("builds an app surface router with assistant and chat routes enabled", () => {
    const authStore = { id: "auth" };
    const workspaceStore = { id: "workspace" };

    const router = createAppRouter({ authStore, workspaceStore });

    expect(mocks.createSurfaceRouter).toHaveBeenCalledWith({
      authStore,
      workspaceStore,
      surface: "app",
      shellComponent: mocks.appShell,
      includeWorkspaceSettings: false,
      includeAssistantRoute: true,
      includeChatRoute: true,
      includeChoiceTwoRoute: false
    });
    expect(router).toEqual({ marker: "app-router" });
  });
});
