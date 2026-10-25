import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultErrorPolicy } from "../src/client/error/policy.js";
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

test("default error policy maps intent to presentation instead of status alone", () => {
  const policy = createDefaultErrorPolicy();

  assert.equal(policy({ intent: "resource-load", message: "Load failed" }).channel, "silent");
  assert.equal(policy({ intent: "action-feedback", message: "Save failed" }).channel, "snackbar");
  assert.equal(policy({ intent: "app-recoverable", message: "Offline" }).channel, "banner");
  assert.equal(policy({ intent: "blocking", message: "Fatal" }).channel, "dialog");
  assert.equal(policy({ blocking: true, message: "Fatal" }).channel, "dialog");
  assert.equal(policy({ status: 500, message: "Server failed" }).channel, "snackbar");
  assert.equal(
    policy({ intent: "resource-load", channel: "banner", message: "Load failed" }).channel,
    "banner"
  );
});

test("error runtime treats resource load errors as silent by default", () => {
  const calls = [];
  const runtime = createErrorRuntime({
    presenters: [
      createPresenter("module.presenter", { calls })
    ],
    moduleDefaultPresenterId: "module.presenter"
  });

  const result = runtime.report({
    kind: "resource-load",
    message: "Unable to load records.",
    status: 500,
    action: {
      label: "Retry",
      handler() {}
    }
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "silent");
  assert.equal(result.event.intent, "resource-load");
  assert.equal(result.decision.channel, "silent");
  assert.equal(calls.length, 0);
});

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

test("error runtime honours an explicit persist on any channel and defaults by channel otherwise", async () => {
  const { createErrorPresentationStore } = await import("../src/client/error/store.js");
  const { createDefaultMaterialErrorPresenters } = await import("../src/client/error/presenters.js");
  const store = createErrorPresentationStore({ now: () => 1000 });
  const runtime = createErrorRuntime({
    presenters: createDefaultMaterialErrorPresenters({ store }),
    moduleDefaultPresenterId: "material.snackbar"
  });

  const persistentSnackbar = runtime.report({ message: "Keep me", channel: "snackbar", persist: true });
  const transientSnackbar = runtime.report({ message: "Drop me", channel: "snackbar" });
  const defaultBanner = runtime.report({ message: "Offline", intent: "app-recoverable" });
  const transientDialog = runtime.report({ message: "Heads up", channel: "dialog", persist: false });

  assert.equal(persistentSnackbar.decision.persist, true);
  assert.equal(transientSnackbar.decision.persist, false);
  assert.equal(defaultBanner.decision.persist, true);
  assert.equal(transientDialog.decision.persist, false);
  const { channels } = store.getState();
  assert.deepEqual(channels.snackbar.map((entry) => [entry.message, entry.persist]), [["Keep me", true], ["Drop me", false]]);
  assert.deepEqual(channels.banner.map((entry) => [entry.message, entry.persist]), [["Offline", true]]);
  assert.deepEqual(channels.dialog.map((entry) => [entry.message, entry.persist]), [["Heads up", false]]);
});

test("default error policy decides only channel and severity", () => {
  const policy = createDefaultErrorPolicy({ defaultSeverity: "warning" });

  assert.deepEqual(policy({ message: "Saved?", action: { label: "Retry" } }), { channel: "snackbar", severity: "warning" });
});
