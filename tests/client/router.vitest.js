import { describe, expect, it, vi } from "vitest";
import { createAppRouter, __testables } from "../../src/router";

describe("router auth guards", () => {
  it("resolveAuthState returns authenticated session", async () => {
    const authStore = {
      isAuthenticated: false,
      ensureSession: vi.fn(async () => ({ authenticated: true })),
      setSignedOut: vi.fn()
    };

    const state = await __testables.resolveAuthState(authStore);
    expect(state).toEqual({ authenticated: true, sessionUnavailable: false });
    expect(authStore.setSignedOut).not.toHaveBeenCalled();
  });

  it("resolveAuthState marks session unavailable on 503", async () => {
    const authStore = {
      isAuthenticated: true,
      ensureSession: vi.fn(async () => {
        const error = new Error("down");
        error.status = 503;
        throw error;
      }),
      setSignedOut: vi.fn()
    };

    const state = await __testables.resolveAuthState(authStore);
    expect(state).toEqual({ authenticated: true, sessionUnavailable: true });
    expect(authStore.setSignedOut).not.toHaveBeenCalled();
  });

  it("resolveAuthState signs out on non-503 error", async () => {
    const authStore = {
      isAuthenticated: true,
      ensureSession: vi.fn(async () => {
        const error = new Error("bad");
        error.status = 401;
        throw error;
      }),
      setSignedOut: vi.fn()
    };

    const state = await __testables.resolveAuthState(authStore);
    expect(state).toEqual({ authenticated: false, sessionUnavailable: false });
    expect(authStore.setSignedOut).toHaveBeenCalledTimes(1);
  });

  it("login guard redirects to calculator when already authenticated", async () => {
    const authStore = {
      isAuthenticated: false,
      ensureSession: vi.fn(async () => ({ authenticated: true })),
      setSignedOut: vi.fn()
    };

    await expect(__testables.beforeLoadLogin(authStore)).rejects.toMatchObject({
      options: { to: "/" }
    });
  });

  it("calculator guard redirects to login when unauthenticated", async () => {
    const authStore = {
      isAuthenticated: false,
      ensureSession: vi.fn(async () => ({ authenticated: false })),
      setSignedOut: vi.fn()
    };

    await expect(__testables.beforeLoadCalculator(authStore)).rejects.toMatchObject({
      options: { to: "/login" }
    });
  });

  it("login and calculator guards allow authenticated/unauthenticated happy paths", async () => {
    const loginStore = {
      isAuthenticated: false,
      ensureSession: vi.fn(async () => ({ authenticated: false })),
      setSignedOut: vi.fn()
    };
    await expect(__testables.beforeLoadLogin(loginStore)).resolves.toBeUndefined();

    const calculatorStore = {
      isAuthenticated: false,
      ensureSession: vi.fn(async () => ({ authenticated: true })),
      setSignedOut: vi.fn()
    };
    await expect(__testables.beforeLoadCalculator(calculatorStore)).resolves.toBeUndefined();
  });

  it("guards allow navigation when session is unavailable", async () => {
    const authStore = {
      isAuthenticated: false,
      ensureSession: vi.fn(async () => {
        const error = new Error("temporarily unavailable");
        error.status = 503;
        throw error;
      }),
      setSignedOut: vi.fn()
    };

    await expect(__testables.beforeLoadLogin(authStore)).resolves.toBeUndefined();
    await expect(__testables.beforeLoadCalculator(authStore)).resolves.toBeUndefined();
  });

  it("creates router instance with configured routes", () => {
    const authStore = {
      isAuthenticated: false,
      ensureSession: vi.fn(async () => ({ authenticated: false })),
      setSignedOut: vi.fn()
    };

    const router = createAppRouter(authStore);
    expect(router).toBeTruthy();
    expect(typeof router.navigate).toBe("function");
  });
});
