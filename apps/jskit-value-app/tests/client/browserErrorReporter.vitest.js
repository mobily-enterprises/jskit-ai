import { beforeEach, describe, expect, it, vi } from "vitest";

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("browserErrorReporter", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    window.history.replaceState({}, "", "/admin/w/acme/settings");
  });

  it("builds browser error payload from ErrorEvent-like input", async () => {
    const { __testables } = await import("../../src/services/browserErrorReporter.js");

    const payload = __testables.createPayloadFromErrorEvent({
      message: "Boom",
      filename: "https://example.com/app.js",
      lineno: 10,
      colno: 20,
      error: new Error("Boom")
    });

    expect(payload.source).toBe("window.error");
    expect(payload.message).toBe("Boom");
    expect(payload.lineNumber).toBe(10);
    expect(payload.columnNumber).toBe(20);
    expect(payload.path).toBe("/admin/w/acme/settings");
    expect(payload.surface).toBe("admin");
    expect(payload.metadata.filename).toBe("https://example.com/app.js");
  });

  it("sends reports as best-effort POST requests", async () => {
    const { __testables } = await import("../../src/services/browserErrorReporter.js");

    await __testables.sendBrowserErrorReport({
      source: "window.error",
      message: "Boom"
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe("/api/console/errors/browser");
    expect(global.fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      keepalive: true
    });
  });

  it("installs global listeners and forwards runtime errors", async () => {
    const reporter = await import("../../src/services/browserErrorReporter.js");
    reporter.installBrowserErrorReporter();

    const error = new Error("Runtime failure");
    const runtimeEvent =
      typeof ErrorEvent === "function"
        ? new ErrorEvent("error", {
            message: "Runtime failure",
            filename: "https://example.com/runtime.js",
            lineno: 1,
            colno: 2,
            error
          })
        : Object.assign(new Event("error"), {
            message: "Runtime failure",
            filename: "https://example.com/runtime.js",
            lineno: 1,
            colno: 2,
            error
          });
    window.dispatchEvent(runtimeEvent);

    await flushMicrotasks();
    expect(global.fetch).toHaveBeenCalled();

    const rejectionEvent = Object.assign(new Event("unhandledrejection"), { reason: new Error("Rejected") });
    window.dispatchEvent(rejectionEvent);
    await flushMicrotasks();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
