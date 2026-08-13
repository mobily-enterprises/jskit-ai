import assert from "node:assert/strict";
import test from "node:test";
import { JskitDestinationLink, isJskitOrdinaryLinkClick } from "./navigationLink.js";

function click(overrides = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides
  };
}

test("destination link intercepts only ordinary same-context primary clicks", () => {
  assert.equal(JskitDestinationLink.name, "JskitDestinationLink");
  assert.equal(isJskitOrdinaryLinkClick(click()), true);
  assert.equal(isJskitOrdinaryLinkClick(click({ ctrlKey: true })), false);
  assert.equal(isJskitOrdinaryLinkClick(click({ metaKey: true })), false);
  assert.equal(isJskitOrdinaryLinkClick(click({ shiftKey: true })), false);
  assert.equal(isJskitOrdinaryLinkClick(click({ button: 1 })), false);
  assert.equal(isJskitOrdinaryLinkClick(click({ defaultPrevented: true })), false);
  assert.equal(isJskitOrdinaryLinkClick(click(), { target: "_blank" }), false);
  assert.equal(isJskitOrdinaryLinkClick(click(), { target: "_self" }), true);
  assert.equal(isJskitOrdinaryLinkClick(click(), { download: true }), false);
});
