import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mountAdminApplication: vi.fn(),
  mountAppApplication: vi.fn()
}));

vi.mock("../../src/main.admin", () => ({
  mountAdminApplication: mocks.mountAdminApplication
}));

vi.mock("../../src/main.app", () => ({
  mountAppApplication: mocks.mountAppApplication
}));

describe("main bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.mountAdminApplication.mockReset();
    mocks.mountAppApplication.mockReset();
    window.history.replaceState({}, "", "/login");
  });

  it("boots app surface for non-admin paths", async () => {
    await import("../../src/main.js");

    expect(mocks.mountAppApplication).toHaveBeenCalledTimes(1);
    expect(mocks.mountAdminApplication).not.toHaveBeenCalled();
  });

  it("boots admin surface for /admin paths", async () => {
    window.history.replaceState({}, "", "/admin/login");

    await import("../../src/main.js");

    expect(mocks.mountAdminApplication).toHaveBeenCalledTimes(1);
    expect(mocks.mountAppApplication).not.toHaveBeenCalled();
  });
});
