import assert from "node:assert/strict";
import test from "node:test";
import { createTestCopyBannerRuntime, installTestCopyBanner } from "../src/client/sideEffects/testCopyBanner.js";

// The part of a document the banner uses: a body to append to, elements, and lookup by id.
function fakeDocument(sideEffects) {
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
    querySelector: () => (sideEffects === undefined ? null : { getAttribute: () => sideEffects })
  };
  return documentObject;
}

test("a simulating page gets one Test copy banner that takes no clicks", () => {
  const documentObject = fakeDocument("simulate");
  const remove = installTestCopyBanner({ documentObject });
  assert.equal(documentObject.appended.length, 1);
  const [banner] = documentObject.appended;
  assert.equal(banner.textContent, "Test copy");
  assert.equal(banner.attributes["aria-label"], "Test copy: emails, messages and payments are simulated, not sent.");
  assert.equal(banner.attributes["data-testid"], "jskit-test-copy-banner");
  assert.equal(banner.style.pointerEvents, "none");
  assert.equal(banner.style.position, "fixed");
  installTestCopyBanner({ documentObject });
  assert.equal(documentObject.appended.length, 1, "never two");
  remove();
  assert.equal(documentObject.appended.length, 0);
});

test("a live page, a page that names no setting and no document get no banner", () => {
  for (const sideEffects of ["live", undefined]) {
    const documentObject = fakeDocument(sideEffects);
    installTestCopyBanner({ documentObject });
    assert.equal(documentObject.appended.length, 0, String(sideEffects));
  }
  assert.doesNotThrow(() => installTestCopyBanner({ documentObject: null })());
});

test("the shell's banner runtime shows the banner on install and removes it on dispose", () => {
  const documentObject = fakeDocument("simulate");
  const runtime = createTestCopyBannerRuntime({ documentObject });
  runtime.install();
  runtime.install();
  assert.equal(documentObject.appended.length, 1);
  runtime.dispose();
  assert.equal(documentObject.appended.length, 0);
  runtime.dispose();
});
