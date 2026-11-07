import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDesktopDrawerClosedMode,
  resolveShellDrawerPresentation,
  resolveShellDrawerToggleLabel,
  shellLayoutHasDrawer,
  shellLayoutHasNavigationBar
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

test("a surface has a drawer for menu destinations of two or more in all, or its own menu, and for its identity beside navigation", () => {
  assert.equal(shellLayoutHasDrawer({ menuCount: 3 }), true);
  assert.equal(shellLayoutHasDrawer({ menuCount: 2 }), true);
  assert.equal(shellLayoutHasDrawer({ menuSlot: true }), true);
  // Home alone is nowhere to go: no drawer, rail or menu control.
  assert.equal(shellLayoutHasDrawer({ menuCount: 1 }), false);
  assert.equal(shellLayoutHasDrawer({ bottomNavigationCount: 1 }), false);
  // A phone's one drawer destination (Settings) beside the bar's (Home) keeps its drawer.
  assert.equal(shellLayoutHasDrawer({ menuCount: 1, bottomNavigationCount: 1 }), true);
  // The workspace switcher keeps the drawer beside Home.
  assert.equal(shellLayoutHasDrawer({ identityCount: 1, menuCount: 1 }), true);
  // A phone whose destinations are all in the navigation bar keeps the drawer for its workspace switcher.
  assert.equal(shellLayoutHasDrawer({ identityCount: 1, bottomNavigationCount: 3 }), true);
  // An empty drawer is not drawn, nor is one holding only the identity on a surface without navigation.
  assert.equal(shellLayoutHasDrawer({ bottomNavigationCount: 3 }), false);
  assert.equal(shellLayoutHasDrawer({ identityCount: 1 }), false);
  assert.equal(shellLayoutHasDrawer(), false);
});

test("a compact window shows the navigation bar for its destinations of two or more in all", () => {
  assert.equal(shellLayoutHasNavigationBar({ bottomNavigationCount: 3 }), true);
  assert.equal(shellLayoutHasNavigationBar({ bottomNavigationCount: 2 }), true);
  assert.equal(shellLayoutHasNavigationBar({ bottomNavigationCount: 1 }), false);
  assert.equal(shellLayoutHasNavigationBar({ bottomNavigationCount: 1, menuCount: 1 }), true);
  assert.equal(shellLayoutHasNavigationBar({ menuCount: 3 }), false);
  assert.equal(shellLayoutHasNavigationBar(), false);
});
