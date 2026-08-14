import assert from "node:assert/strict";
import test from "node:test";
import { activateShellNavigationLinkOnSpace } from "../src/client/support/navigationLinkKeyboard.js";

test("Space activates a shell navigation link once and suppresses page scrolling", () => {
  const calls = [];
  activateShellNavigationLinkOnSpace({
    key: " ",
    currentTarget: {
      click() {
        calls.push("click");
      }
    },
    preventDefault() {
      calls.push("preventDefault");
    },
    stopPropagation() {
      calls.push("stopPropagation");
    }
  });

  assert.deepEqual(calls, ["preventDefault", "stopPropagation", "click"]);
});

test("other keys retain native link behavior", () => {
  let clicked = false;
  activateShellNavigationLinkOnSpace({
    key: "Enter",
    currentTarget: {
      click() {
        clicked = true;
      }
    }
  });
  assert.equal(clicked, false);
});
