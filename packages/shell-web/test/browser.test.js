import assert from "node:assert/strict";
import test from "node:test";
import {
  closestElement,
  pageDocument,
  pageOrigin,
  pagePathname,
  pageStorage,
  pageTitle,
  pageViewportWidth,
  pageWindow
} from "../src/client/browser.js";

test("outside a browser every page read is empty", () => {
  assert.equal(pageWindow(), null);
  assert.equal(pageDocument(), null);
  assert.equal(pagePathname(), "");
  assert.equal(pageOrigin(), "");
  assert.equal(pageTitle(), "");
  assert.equal(pageViewportWidth(), 0);
  assert.equal(pageStorage(), null);
});

test("in a browser the page reads come from the window and the document", (t) => {
  const localStorage = {};
  globalThis.window = {
    innerWidth: 390,
    localStorage,
    location: { pathname: " /home ", origin: "https://app.test" }
  };
  globalThis.document = { title: "App" };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });

  assert.equal(pagePathname(), "/home");
  assert.equal(pageOrigin(), "https://app.test");
  assert.equal(pageTitle(), "App");
  assert.equal(pageViewportWidth(), 390);
  assert.equal(pageStorage(), localStorage);
});

test("an event target that is not an element has no closest element", () => {
  const element = {};

  assert.equal(closestElement({ closest: () => element }, "a"), element);
  assert.equal(closestElement({ closest: () => null }, "a"), null);
  assert.equal(closestElement({}, "a"), null);
  assert.equal(closestElement(null, "a"), null);
});
