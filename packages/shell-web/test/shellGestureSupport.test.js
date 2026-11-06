import assert from "node:assert/strict";
import test from "node:test";
import { isPrimaryTouchPointer, isShellGestureIgnoredTarget } from "../src/client/support/gestureTargets.js";
import { resolveShellLayoutClass } from "../src/client/support/shellLayoutClass.js";
import { resolveWindowSizeClass } from "../src/client/support/windowSizeClass.js";

function createTarget(matchingSelectors = []) {
  return {
    closest(selectorList) {
      const selectors = selectorList.split(",");
      return matchingSelectors.some((selector) => selectors.includes(selector)) ? {} : null;
    }
  };
}

test("shell layout class is the Material 3 window size class, with large placed like expanded", () => {
  assert.equal(resolveShellLayoutClass(390), "compact");
  assert.equal(resolveShellLayoutClass(599), "compact");
  assert.equal(resolveShellLayoutClass(600), "medium");
  assert.equal(resolveShellLayoutClass(768), "medium");
  assert.equal(resolveShellLayoutClass(839), "medium");
  assert.equal(resolveShellLayoutClass(840), "expanded");
  assert.equal(resolveShellLayoutClass(1199), "expanded");
  assert.equal(resolveShellLayoutClass(1280), "expanded");
  assert.equal(resolveShellLayoutClass(1920), "expanded");
});

test("window size classes follow the Material 3 breakpoints", () => {
  assert.equal(resolveWindowSizeClass(0), "compact");
  assert.equal(resolveWindowSizeClass(599), "compact");
  assert.equal(resolveWindowSizeClass(600), "medium");
  assert.equal(resolveWindowSizeClass(840), "expanded");
  assert.equal(resolveWindowSizeClass(1199), "expanded");
  assert.equal(resolveWindowSizeClass(1200), "large");
  assert.equal(resolveWindowSizeClass(2400), "large");
});

test("shell gestures follow primary touch and pen pointers only", () => {
  assert.equal(isPrimaryTouchPointer({ isPrimary: true, button: 0, pointerType: "touch" }), true);
  assert.equal(isPrimaryTouchPointer({ button: 0, pointerType: "pen" }), true);
  assert.equal(isPrimaryTouchPointer({ isPrimary: true, button: 0, pointerType: "mouse" }), false);
  assert.equal(isPrimaryTouchPointer({ isPrimary: false, button: 0, pointerType: "touch" }), false);
  assert.equal(isPrimaryTouchPointer({ isPrimary: true, button: 2, pointerType: "touch" }), false);
});

test("shell gestures skip interactive targets and honour extra ignore selectors", () => {
  assert.equal(isShellGestureIgnoredTarget(createTarget(["button"])), true);
  assert.equal(isShellGestureIgnoredTarget(createTarget(["[data-shell-swipe-ignore]"])), true);
  assert.equal(isShellGestureIgnoredTarget(createTarget(["[data-shell-pull-refresh-ignore]"])), false);
  assert.equal(
    isShellGestureIgnoredTarget(createTarget(["[data-shell-pull-refresh-ignore]"]), {
      extraSelectors: ["[data-shell-pull-refresh-ignore]"]
    }),
    true
  );
  assert.equal(isShellGestureIgnoredTarget(createTarget([])), false);
  assert.equal(isShellGestureIgnoredTarget(null), false);
});
