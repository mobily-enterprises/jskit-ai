import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSurfaceRouter: vi.fn(),
  adminShell: {
    name: "AdminShellStub"
  }
}));

vi.mock("../../src/app/router/factory.js", () => ({
  createSurfaceRouter: (...args) => mocks.createSurfaceRouter(...args)
}));

vi.mock("../../src/app/shells/admin/AdminShell.vue", () => ({
  default: mocks.adminShell
}));

import { createAdminRouter } from "../../src/app/router/admin.js";

describe("createAdminRouter", () => {
  beforeEach(() => {
    mocks.createSurfaceRouter.mockReset();
    mocks.createSurfaceRouter.mockReturnValue({ marker: "admin-router" });
  });

  it("builds an admin surface router with workspace settings, assistant, and chat routes enabled", () => {
    const authStore = { id: "auth" };
    const workspaceStore = { id: "workspace" };

    const router = createAdminRouter({ authStore, workspaceStore });

    expect(mocks.createSurfaceRouter).toHaveBeenCalledWith({
      authStore,
      workspaceStore,
      surface: "admin",
      shellComponent: mocks.adminShell,
      includeWorkspaceSettings: true,
      includeAssistantRoute: true,
      includeChatRoute: true
    });
    expect(router).toEqual({ marker: "admin-router" });
  });
});
