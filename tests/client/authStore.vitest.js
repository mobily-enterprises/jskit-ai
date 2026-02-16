import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  sessionApi: vi.fn()
}));

vi.mock("../../src/queryClient", () => ({
  queryClient: {
    ensureQueryData: mocks.ensureQueryData,
    setQueryData: mocks.setQueryData,
    invalidateQueries: mocks.invalidateQueries
  }
}));

vi.mock("../../src/services/api", () => ({
  api: {
    session: mocks.sessionApi
  }
}));

import { SESSION_QUERY_KEY, useAuthStore } from "../../src/stores/authStore";

describe("authStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.ensureQueryData.mockReset();
    mocks.setQueryData.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.sessionApi.mockReset();
  });

  it("applySession sets authenticated user data", () => {
    const store = useAuthStore();

    const session = store.applySession({ authenticated: true, username: "alice" });

    expect(session).toEqual({ authenticated: true, username: "alice" });
    expect(store.authenticated).toBe(true);
    expect(store.username).toBe("alice");
    expect(store.initialized).toBe(true);
    expect(store.isAuthenticated).toBe(true);
  });

  it("applySession keeps username null when authenticated session omits username", () => {
    const store = useAuthStore();

    const session = store.applySession({ authenticated: true });

    expect(session).toEqual({ authenticated: true });
    expect(store.authenticated).toBe(true);
    expect(store.username).toBeNull();
  });

  it("ensureSession(force=true) calls api and updates cache", async () => {
    const store = useAuthStore();
    mocks.sessionApi.mockResolvedValue({ authenticated: true, username: "bob" });

    const session = await store.ensureSession({ force: true });

    expect(mocks.sessionApi).toHaveBeenCalledTimes(1);
    expect(mocks.setQueryData).toHaveBeenCalledWith(SESSION_QUERY_KEY, { authenticated: true, username: "bob" });
    expect(session).toEqual({ authenticated: true, username: "bob" });
    expect(store.authenticated).toBe(true);
    expect(store.username).toBe("bob");
  });

  it("ensureSession uses query cache when initialized", async () => {
    const store = useAuthStore();
    store.initialized = true;
    mocks.ensureQueryData.mockResolvedValue({ authenticated: true, username: "cache-user" });

    const session = await store.ensureSession();

    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1);
    expect(session).toEqual({ authenticated: true, username: "cache-user" });
  });

  it("ensureSession uses query cache when uninitialized", async () => {
    const store = useAuthStore();
    mocks.ensureQueryData.mockResolvedValue({ authenticated: false });

    const session = await store.ensureSession();

    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1);
    expect(session).toEqual({ authenticated: false });
    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
  });

  it("ensureSession provides query options with session query function", async () => {
    const store = useAuthStore();
    mocks.sessionApi.mockResolvedValue({ authenticated: true, username: "query-fn-user" });
    mocks.ensureQueryData.mockImplementation(async (queryOptions) => queryOptions.queryFn());

    const session = await store.ensureSession();

    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1);
    const queryOptions = mocks.ensureQueryData.mock.calls[0][0];
    expect(queryOptions.queryKey).toEqual(SESSION_QUERY_KEY);
    expect(queryOptions.staleTime).toBe(60000);
    expect(session).toEqual({ authenticated: true, username: "query-fn-user" });
    expect(mocks.sessionApi).toHaveBeenCalledTimes(1);
  });

  it("refreshSession delegates to forced ensureSession", async () => {
    const store = useAuthStore();
    mocks.sessionApi.mockResolvedValue({ authenticated: true, username: "refresh-user" });

    const session = await store.refreshSession();

    expect(mocks.sessionApi).toHaveBeenCalledTimes(1);
    expect(session).toEqual({ authenticated: true, username: "refresh-user" });
  });

  it("invalidateSession resets initialized state and invalidates query", async () => {
    const store = useAuthStore();
    store.initialized = true;
    mocks.invalidateQueries.mockResolvedValue(undefined);

    await store.invalidateSession();

    expect(store.initialized).toBe(false);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: SESSION_QUERY_KEY });
  });

  it("setSignedOut clears auth state and writes anonymous session cache", () => {
    const store = useAuthStore();
    store.authenticated = true;
    store.username = "charlie";

    store.setSignedOut();

    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
    expect(store.initialized).toBe(true);
    expect(mocks.setQueryData).toHaveBeenCalledWith(SESSION_QUERY_KEY, { authenticated: false });
  });

  it("setUsername normalizes nullable values", () => {
    const store = useAuthStore();

    store.setUsername("alice");
    expect(store.username).toBe("alice");

    store.setUsername(0);
    expect(store.username).toBeNull();
  });
});
