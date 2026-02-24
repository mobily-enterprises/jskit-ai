import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mountAdminApplication: vi.fn(),
  mountAppApplication: vi.fn()
}));

vi.mock("../../src/app/bootstrap/main.admin.public.js", () => ({
  mountAdminApplication: mocks.mountAdminApplication
}));

vi.mock("../../src/app/bootstrap/main.app.public.js", () => ({
  mountAppApplication: mocks.mountAppApplication
}));

describe("main public bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.mountAdminApplication.mockReset();
    mocks.mountAppApplication.mockReset();
    window.history.replaceState({}, "", "/login");
  });

  it("boots app surface for non-admin paths", async () => {
    await import("../../src/app/bootstrap/main.public.js");

    expect(mocks.mountAppApplication).toHaveBeenCalledTimes(1);
    expect(mocks.mountAdminApplication).not.toHaveBeenCalled();
  });

  it("boots admin surface for /admin paths", async () => {
    window.history.replaceState({}, "", "/admin/login");

    await import("../../src/app/bootstrap/main.public.js");

    expect(mocks.mountAdminApplication).toHaveBeenCalledTimes(1);
    expect(mocks.mountAppApplication).not.toHaveBeenCalled();
  });

  it("routes /console paths to app login flow", async () => {
    window.history.replaceState({}, "", "/console/login");

    await import("../../src/app/bootstrap/main.public.js");

    expect(window.location.pathname).toBe("/login");
    expect(mocks.mountAppApplication).toHaveBeenCalledTimes(1);
    expect(mocks.mountAdminApplication).not.toHaveBeenCalled();
  });
});
