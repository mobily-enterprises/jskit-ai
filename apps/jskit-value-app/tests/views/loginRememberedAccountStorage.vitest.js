import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRememberedAccountHint,
  createRememberedAccountHint,
  readRememberedAccountHint,
  writeRememberedAccountHint
} from "../../src/views/login/lib/loginRememberedAccountStorage.js";

describe("loginRememberedAccountStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates remembered-account hints with masked email and fallback display name", () => {
    const hint = createRememberedAccountHint({
      email: "User@example.com",
      displayName: "Tony",
      lastUsedAt: "2026-02-17T00:00:00.000Z"
    });
    expect(hint).toEqual({
      displayName: "Tony",
      maskedEmail: "u***@example.com",
      lastUsedAt: "2026-02-17T00:00:00.000Z"
    });

    const noEmailHint = createRememberedAccountHint({
      email: "",
      maskedEmail: "a***@example.com",
      displayName: ""
    });
    expect(noEmailHint.displayName).toBe("User");
    expect(noEmailHint.maskedEmail).toBe("a***@example.com");
  });

  it("writes, reads, and clears persisted hint payloads", () => {
    const hint = {
      displayName: "Chiara",
      maskedEmail: "c***@example.com",
      lastUsedAt: "2026-02-17T00:00:00.000Z"
    };

    writeRememberedAccountHint(hint);
    const storedRaw = window.localStorage.getItem("auth.rememberedAccount");
    expect(storedRaw).toContain("Chiara");

    const readHint = readRememberedAccountHint();
    expect(readHint).toEqual(hint);

    clearRememberedAccountHint();
    expect(window.localStorage.getItem("auth.rememberedAccount")).toBe(null);
    expect(readRememberedAccountHint()).toBe(null);
  });

  it("handles malformed storage payloads and unavailable localStorage", () => {
    window.localStorage.setItem("auth.rememberedAccount", "not-json");
    expect(readRememberedAccountHint()).toBe(null);

    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      expect(readRememberedAccountHint()).toBe(null);
      writeRememberedAccountHint({
        displayName: "Tony",
        maskedEmail: "t***@example.com",
        lastUsedAt: "2026-02-17T00:00:00.000Z"
      });
      clearRememberedAccountHint();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });

  it("swallows localStorage probe and write/remove failures", () => {
    const originalWindow = globalThis.window;
    const setItem = vi.fn(() => {
      throw new Error("blocked");
    });
    const removeItem = vi.fn(() => {
      throw new Error("blocked");
    });

    vi.stubGlobal("window", {
      localStorage: {
        setItem,
        removeItem,
        getItem: vi.fn(() => null)
      }
    });

    try {
      expect(readRememberedAccountHint()).toBe(null);
      writeRememberedAccountHint({
        displayName: "Tony",
        maskedEmail: "t***@example.com",
        lastUsedAt: "2026-02-17T00:00:00.000Z"
      });
      clearRememberedAccountHint();
      expect(setItem).toHaveBeenCalled();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });
});
