import assert from "node:assert/strict";
import test from "node:test";
import { createErrorRuntime } from "../src/client/error/runtime.js";

function createPresenter(id, {
  channels = ["snackbar", "banner", "dialog"],
  calls = []
} = {}) {
  const supported = new Set(channels);
  return Object.freeze({
    id,
    supports(channel = "") {
      return supported.has(String(channel || "").trim().toLowerCase());
    },
    present(payload = {}) {
      calls.push({
        presenterId: id,
        payload
      });
      return `${id}-${calls.length}`;
    },
    dismiss() {
      return 0;
    }
  });
}

test("error runtime prefers policy presenter over app and module defaults", () => {
  const calls = [];
  const runtime = createErrorRuntime({
    presenters: [
      createPresenter("module.presenter", { calls }),
      createPresenter("app.presenter", { calls }),
      createPresenter("policy.presenter", { calls })
    ],
    moduleDefaultPresenterId: "module.presenter"
  });

  runtime.configure({
    defaultPresenterId: "app.presenter",
    policy: () => ({
      channel: "dialog",
      presenterId: "policy.presenter",
      message: "Policy override"
    })
  });

  const result = runtime.report({
    source: "test.runtime",
    message: "failure"
  });

  assert.equal(result.decision.presenterId, "policy.presenter");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].presenterId, "policy.presenter");
});

test("error runtime uses app default presenter when policy omits presenter", () => {
  const calls = [];
  const runtime = createErrorRuntime({
    presenters: [
      createPresenter("module.presenter", { calls }),
      createPresenter("app.presenter", { calls })
    ],
    moduleDefaultPresenterId: "module.presenter"
  });

  runtime.configure({
    defaultPresenterId: "app.presenter",
    policy: () => ({
      channel: "banner",
      message: "App default"
    })
  });

  const result = runtime.report({
    source: "test.runtime",
    message: "failure"
  });

  assert.equal(result.decision.presenterId, "app.presenter");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].presenterId, "app.presenter");
});

test("error runtime falls back to module default presenter", () => {
  const calls = [];
  const runtime = createErrorRuntime({
    presenters: [
      createPresenter("module.presenter", { calls })
    ],
    moduleDefaultPresenterId: "module.presenter",
    policy: () => ({
      channel: "snackbar",
      message: "Module default"
    })
  });

  const result = runtime.report({
    source: "test.runtime",
    message: "failure"
  });

  assert.equal(result.decision.presenterId, "module.presenter");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].presenterId, "module.presenter");
});

test("error runtime fails fast when module default presenter is unresolved", () => {
  assert.throws(
    () =>
      createErrorRuntime({
        presenters: [createPresenter("registered.presenter")],
        moduleDefaultPresenterId: "missing.presenter"
      }),
    /Module default error presenter "missing.presenter" is not registered/,
  );
});

test("error runtime fails fast when app default presenter is unresolved", () => {
  const runtime = createErrorRuntime({
    presenters: [createPresenter("module.presenter")],
    moduleDefaultPresenterId: "module.presenter"
  });

  assert.throws(
    () => runtime.setAppDefaultPresenterId("missing.presenter"),
    /App default error presenter "missing.presenter" is not registered/,
  );
});

test("error runtime throws when policy presenter is unknown", () => {
  const runtime = createErrorRuntime({
    presenters: [createPresenter("module.presenter")],
    moduleDefaultPresenterId: "module.presenter",
    policy: () => ({
      channel: "dialog",
      presenterId: "missing.presenter",
      message: "failure"
    })
  });

  assert.throws(
    () => runtime.report({ source: "test.runtime", message: "failure" }),
    /Policy-selected error presenter "missing.presenter" is not registered/,
  );
});

test("error runtime falls back to a channel-compatible presenter when default presenter does not support channel", () => {
  const runtime = createErrorRuntime({
    presenters: [
      createPresenter("module.presenter"),
      createPresenter("app.presenter", { channels: ["banner"] })
    ],
    moduleDefaultPresenterId: "module.presenter"
  });

  runtime.configure({
    defaultPresenterId: "app.presenter",
    policy: () => ({
      channel: "dialog",
      message: "unsupported channel"
    })
  });

  const result = runtime.report({ source: "test.runtime", message: "failure" });
  assert.equal(result.decision.presenterId, "module.presenter");
});

test("error runtime throws when no presenter supports channel", () => {
  const runtime = createErrorRuntime({
    presenters: [
      createPresenter("module.presenter", { channels: ["snackbar"] }),
      createPresenter("app.presenter", { channels: ["banner"] })
    ],
    moduleDefaultPresenterId: "module.presenter"
  });

  runtime.configure({
    defaultPresenterId: "app.presenter",
    policy: () => ({
      channel: "dialog",
      message: "unsupported channel"
    })
  });

  assert.throws(
    () => runtime.report({ source: "test.runtime", message: "failure" }),
    /No error presenter supports channel "dialog"/,
  );
});
