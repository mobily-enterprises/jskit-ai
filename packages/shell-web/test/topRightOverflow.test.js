import assert from "node:assert/strict";
import test from "node:test";
import { resolveTopRightItemsInMenu } from "../src/client/support/topRightOverflow.js";

// A 390dp phone's bar after its padding and Up arrow: 326dp for the title, three 48dp items and the 48dp overflow
// button that the page's actions already need.
const PHONE = Object.freeze({ room: 326, items: [48, 48, 48], menuButton: 48, menuShown: true, keepLast: true });

test("a compact bar keeps every top-right item that fits beside the whole title", () => {
  assert.equal(resolveTopRightItemsInMenu({ ...PHONE, title: 70 }), 0, "a short title leaves room for all three");
  assert.equal(resolveTopRightItemsInMenu({ ...PHONE, title: 134 }), 0, "a title that fits to the pixel");
  assert.equal(resolveTopRightItemsInMenu({ ...PHONE, title: 135 }), 1, "the item farthest from the corner moves first");
  assert.equal(resolveTopRightItemsInMenu({ ...PHONE, title: 190 }), 2);
  assert.equal(resolveTopRightItemsInMenu({ ...PHONE, title: 400 }), 2, "the avatar stays beside a title too long for the bar");
});

test("the overflow button the items need takes room, and a primary action lets every item go", () => {
  // No page action in the menu: the bar draws no overflow button while every item is in it.
  const ownMenu = { ...PHONE, menuShown: false };
  assert.equal(resolveTopRightItemsInMenu({ ...ownMenu, title: 182 }), 0, "every item fits, with no menu button");
  assert.equal(
    resolveTopRightItemsInMenu({ ...ownMenu, title: 183 }),
    2,
    "moving one item makes room for the menu button only, so two move"
  );

  const form = { ...PHONE, keepLast: false };
  assert.equal(resolveTopRightItemsInMenu({ ...form, title: 70 }), 0, "beside Save, whatever fits stays");
  assert.equal(resolveTopRightItemsInMenu({ ...form, title: 400 }), 3, "the avatar goes too when the title needs it");
  assert.equal(resolveTopRightItemsInMenu({ ...PHONE, items: [], title: 400 }), 0);
});
