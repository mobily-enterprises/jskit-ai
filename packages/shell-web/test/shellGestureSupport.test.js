import assert from "node:assert/strict";
import test from "node:test";
import { isPrimaryTouchPointer, isShellGestureIgnoredTarget } from "../src/client/support/gestureTargets.js";
import { resolveShellLayoutClass } from "../src/client/support/shellLayoutClass.js";

function createTarget(matchingSelectors = []) {
  return {
    closest(selectorList) {
      const selectors = selectorList.split(",");
      return matchingSelectors.some((selector) => selectors.includes(selector)) ? {} : null;
    }
  };
}

test("shell layout class follows the display breakpoint, then the viewport width", () => {
  assert.equal(resolveShellLayoutClass("xs", 1600), "compact");
  assert.equal(resolveShellLayoutClass("SM"), "compact");
  assert.equal(resolveShellLayoutClass("md", 300), "medium");
  assert.equal(resolveShellLayoutClass("xxl", 300), "expanded");
  assert.equal(resolveShellLayoutClass("", 599), "compact");
  assert.equal(resolveShellLayoutClass(undefined, 600), "medium");
  assert.equal(resolveShellLayoutClass("", 1280), "expanded");
  assert.equal(resolveShellLayoutClass("", 0), "expanded");
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
