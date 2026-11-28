import assert from "node:assert/strict";
import test from "node:test";
import { resolveTopRightItemsInMenu, resolveWideBarItems } from "../src/client/support/topRightOverflow.js";

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

// whs2's record page in a 900px window beside the open drawer: a 596px bar, 572px of it for the title (200px before it
// truncates), Submit (the primary action, 90px), Close (67px) and the bar's own items: three icons and the account,
// 216px with its name and 48px without. Chromium drew the name and clipped the title to 8px, Submit cut off.
const WHS2 = Object.freeze({
  room: 572,
  title: 200,
  primary: 90,
  actions: 67,
  items: [{ labelled: 48, bare: 48 }, { labelled: 48, bare: 48 }, { labelled: 64, bare: 64 }, { labelled: 216, bare: 48 }],
  menuButton: 48,
  menuShown: false,
  keepLast: false
});

test("a wider bar shows its items' labels only beside the title, every page action and every item", () => {
  assert.deepEqual(resolveWideBarItems({ ...WHS2, room: 733 }), { labels: true, inMenu: 0 }, "everything fits to the pixel");
  assert.deepEqual(resolveWideBarItems({ ...WHS2, room: 733, menuShown: true }), { labels: false, inMenu: 0 },
    "an action marked overflow needs the menu button beside them");
  assert.deepEqual(resolveWideBarItems(WHS2), { labels: false, inMenu: 0 },
    "the account's name gives way, and Close and every item stay beside the title");
  assert.deepEqual(resolveWideBarItems({ ...WHS2, room: 700 }), { labels: false, inMenu: 0 },
    "the name gives way before an action folds, though it fits beside the title and Submit");
});

test("a wider bar moves its items into the menu, farthest from the corner first, only once its page actions have folded", () => {
  // A medium bar keeps its whole title: 300px here, with Close folded, so the menu button shows.
  const medium = { ...WHS2, title: 300 };
  assert.deepEqual(resolveWideBarItems({ ...medium, room: 665 }), { labels: false, inMenu: 0 }, "everything fits without the name");
  assert.deepEqual(resolveWideBarItems({ ...medium, room: 646 }), { labels: false, inMenu: 0 },
    "Close folds, and the items fit beside the menu button");
  assert.deepEqual(resolveWideBarItems({ ...medium, room: 645 }), { labels: false, inMenu: 1 }, "then the first item moves");
  assert.deepEqual(resolveWideBarItems(medium), { labels: false, inMenu: 2 });
  assert.deepEqual(resolveWideBarItems({ ...medium, room: 300 }), { labels: false, inMenu: 4 }, "beside Submit the account goes too");
  // Without a primary action the account, nearest the corner, stays.
  assert.deepEqual(resolveWideBarItems({ ...medium, primary: 0, keepLast: true, room: 300 }), { labels: false, inMenu: 3 });
  assert.equal(resolveWideBarItems({ ...medium, items: [], room: 300 }).inMenu, 0);
});
