import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  authStore: {
    setSignedOut: vi.fn()
  },
  godStore: {
    clearGodState: vi.fn()
  },
  workspaceStore: {
    clearWorkspaceState: vi.fn()
  }
}));

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: (options) => {
    const state = { location: { pathname: "/" } };
    return {
      value: options?.select ? options.select(state) : state
    };
  }
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

vi.mock("../../src/stores/godStore.js", () => ({
  useGodStore: () => mocks.godStore
}));

import { isUnauthorizedError, useAuthGuard } from "../../src/composables/useAuthGuard.js";

describe("useAuthGuard", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.godStore.clearGodState.mockReset();
    mocks.workspaceStore.clearWorkspaceState.mockReset();
  });

  it("detects unauthorized status", () => {
    expect(isUnauthorizedError({ status: 401 })).toBe(true);
    expect(isUnauthorizedError({ status: "401" })).toBe(true);
    expect(isUnauthorizedError({ status: 500 })).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });

  it("signs out and redirects only for unauthorized errors", async () => {
    const guard = useAuthGuard();

    await expect(guard.handleUnauthorizedError({ status: 500 })).resolves.toBe(false);
    expect(mocks.authStore.setSignedOut).not.toHaveBeenCalled();
    expect(mocks.godStore.clearGodState).not.toHaveBeenCalled();
    expect(mocks.workspaceStore.clearWorkspaceState).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    await expect(guard.handleUnauthorizedError({ status: 401 })).resolves.toBe(true);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.godStore.clearGodState).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });
});
