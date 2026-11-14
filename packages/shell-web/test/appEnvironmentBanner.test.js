import assert from "node:assert/strict";
import test from "node:test";
import { createAppEnvironmentBannerRuntime, installAppEnvironmentBanner } from "../src/client/appEnvironment/appEnvironmentBanner.js";

// The part of a document the banner uses: a body to append to, elements, and lookup by id.
function fakeDocument(environment) {
  const appended = [];
  const documentObject = {
    appended,
    body: {
      append(element) {
        appended.push(element);
        element.remove = () => appended.splice(appended.indexOf(element), 1);
      }
    },
    createElement(tag) {
      const attributes = {};
      return { tag, style: {}, attributes, setAttribute: (name, value) => { attributes[name] = value; } };
    },
    getElementById: (id) => appended.find((element) => element.id === id) || null,
    querySelector: () => (environment === undefined ? null : { getAttribute: () => environment })
  };
  return documentObject;
}

test("a development, test or staging page gets one banner naming its environment, which takes no clicks", () => {
  for (const [environment, label, description] of [
    ["development", "Development", "Development: emails and messages are logged, not sent; payments use the sandbox."],
    ["test", "Test", "Test: emails and messages are logged, not sent; payments use the sandbox."],
    ["staging", "Staging", "Staging: email and text messages reach only the staging test addresses, other messages are " +
      "logged and payments use the sandbox."]
  ]) {
    const documentObject = fakeDocument(environment);
    const remove = installAppEnvironmentBanner({ documentObject });
    assert.equal(documentObject.appended.length, 1, environment);
    const [banner] = documentObject.appended;
    assert.equal(banner.textContent, label);
    assert.equal(banner.attributes.role, "note");
    assert.equal(banner.attributes["aria-description"], description);
    // No label, so a field lookup by label (Playwright's getByLabel reads aria-label and aria-labelledby) never finds it.
    assert.equal("aria-label" in banner.attributes, false);
    assert.equal("aria-labelledby" in banner.attributes, false);
    assert.equal(banner.attributes["data-testid"], "jskit-app-environment-banner");
    assert.equal(banner.style.pointerEvents, "none");
    assert.equal(banner.style.position, "fixed");
    installAppEnvironmentBanner({ documentObject });
    assert.equal(documentObject.appended.length, 1, "never two");
    remove();
    assert.equal(documentObject.appended.length, 0);
  }
});

test("a production page, a page that names no environment and no document get no banner", () => {
  for (const environment of ["production", "", "live", undefined]) {
    const documentObject = fakeDocument(environment);
    installAppEnvironmentBanner({ documentObject });
    assert.equal(documentObject.appended.length, 0, String(environment));
  }
  assert.doesNotThrow(() => installAppEnvironmentBanner({ documentObject: null })());
});

test("the shell's banner runtime shows the banner on install and removes it on dispose", () => {
  const documentObject = fakeDocument("development");
  const runtime = createAppEnvironmentBannerRuntime({ documentObject });
  runtime.install();
  runtime.install();
  assert.equal(documentObject.appended.length, 1);
  runtime.dispose();
  assert.equal(documentObject.appended.length, 0);
  runtime.dispose();
});
