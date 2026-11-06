import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDesktopDrawerClosedMode,
  resolveShellDrawerPresentation,
  resolveShellDrawerToggleLabel
} from "../src/client/support/drawerPresentation.js";

test("wide closed navigation defaults to a visible Material navigation rail", () => {
  assert.deepEqual(
    resolveShellDrawerPresentation({ modal: false, open: false }),
    {
      visible: true,
      rail: true,
      kind: "rail",
      closedMode: "rail"
    }
  );
});

test("closed modal navigation dismisses instead of retaining a rail", () => {
  assert.deepEqual(
    resolveShellDrawerPresentation({ modal: true, open: false }),
    {
      visible: false,
      rail: false,
      kind: "modal",
      closedMode: "rail"
    }
  );
});

test("desktopDrawerClosedMode hidden preserves an explicitly hidden wide drawer", () => {
  assert.equal(normalizeDesktopDrawerClosedMode("hidden"), "hidden");
  assert.deepEqual(
    resolveShellDrawerPresentation({
      modal: false,
      open: false,
      desktopClosedMode: "hidden"
    }),
    {
      visible: false,
      rail: false,
      kind: "hidden",
      closedMode: "hidden"
    }
  );
});

test("open navigation renders as a full drawer and labels its toggle responsively", () => {
  assert.deepEqual(
    resolveShellDrawerPresentation({ modal: false, open: true }),
    {
      visible: true,
      rail: false,
      kind: "drawer",
      closedMode: "rail"
    }
  );
  assert.equal(
    resolveShellDrawerToggleLabel({ modal: false, open: true }),
    "Collapse navigation drawer"
  );
  assert.equal(
    resolveShellDrawerToggleLabel({ modal: true, open: false }),
    "Open navigation menu"
  );
});
