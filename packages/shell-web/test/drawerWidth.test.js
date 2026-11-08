import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SHELL_DRAWER_WIDTH,
  DEFAULT_SHELL_NAVIGATION_ITEM_SPACING,
  DEFAULT_SHELL_RAIL_WIDTH,
  measureDrawerContentWidth,
  normalizeShellDrawerWidth,
  normalizeShellNavigationItemSpacing,
  normalizeShellRailWidth,
  resolveContentAwareDrawerWidth
} from "../src/client/support/drawerWidth.js";

test("content-aware drawer width includes the rendered label start, width, and balanced end spacing", () => {
  assert.equal(
    resolveContentAwareDrawerWidth([
      { logicalStart: 72, textWidth: 40 },
      { logicalStart: 72, textWidth: 78 }
    ]),
    162
  );
  assert.equal(
    resolveContentAwareDrawerWidth([
      { logicalStart: 72, textWidth: 99.015625 }
    ]),
    183.25
  );
});

test("drawer and rail widths have stable defaults and bounded overrides", () => {
  assert.equal(DEFAULT_SHELL_RAIL_WIDTH, 80);
  assert.equal(normalizeShellDrawerWidth(null), DEFAULT_SHELL_DRAWER_WIDTH);
  assert.equal(normalizeShellDrawerWidth(180), 180);
  assert.equal(normalizeShellDrawerWidth(1000), 360);
  assert.equal(normalizeShellRailWidth(null), DEFAULT_SHELL_RAIL_WIDTH);
  assert.equal(normalizeShellRailWidth(96), 96);
  assert.equal(normalizeShellRailWidth(20), 48);
});

test("navigation item spacing has a Material-aligned default and bounded overrides", () => {
  assert.equal(DEFAULT_SHELL_NAVIGATION_ITEM_SPACING, 12);
  assert.equal(normalizeShellNavigationItemSpacing(null), DEFAULT_SHELL_NAVIGATION_ITEM_SPACING);
  assert.equal(normalizeShellNavigationItemSpacing(14), 14);
  assert.equal(normalizeShellNavigationItemSpacing(2), 8);
  assert.equal(normalizeShellNavigationItemSpacing(100), 24);
});

test("content-aware width ignores invalid measurements and uses a bounded fallback", () => {
  assert.equal(
    resolveContentAwareDrawerWidth([
      { logicalStart: -1, textWidth: 20 },
      { logicalStart: 40, textWidth: Number.NaN }
    ]),
    DEFAULT_SHELL_DRAWER_WIDTH
  );
  assert.equal(
    resolveContentAwareDrawerWidth([{ logicalStart: 72, textWidth: 900 }]),
    360
  );
});

function installMeasuredPage(t, { drawerStyle, textRects }) {
  globalThis.window = {
    getComputedStyle: (element) => element.style || drawerStyle
  };
  globalThis.document = {
    createRange() {
      let rect = null;
      return {
        selectNodeContents(element) {
          rect = textRects.get(element);
        },
        getBoundingClientRect: () => rect
      };
    }
  };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });
}

function createLabel(style = {}) {
  return { style: { display: "block", visibility: "visible", ...style } };
}

test("the drawer measures the labels people can see, from its inline start", (t) => {
  const wide = createLabel();
  const hidden = createLabel({ visibility: "hidden" });
  const collapsed = createLabel({ display: "none" });
  const empty = createLabel();
  installMeasuredPage(t, {
    drawerStyle: { direction: "ltr", borderRightWidth: "1px", borderLeftWidth: "9px" },
    textRects: new Map([
      [wide, { left: 56, right: 156, width: 100 }],
      [hidden, { left: 56, right: 356, width: 300 }],
      [collapsed, { left: 56, right: 356, width: 300 }],
      [empty, { left: 56, right: 56, width: 0 }]
    ])
  });

  const width = measureDrawerContentWidth({
    getBoundingClientRect: () => ({ left: 40, right: 288 }),
    querySelector: () => null,
    querySelectorAll: () => [wide, hidden, collapsed, empty]
  }, 12);

  assert.equal(width, 16 + 100 + 12 + 1);
});

test("a right-to-left drawer measures from its right edge and ends at its left border", (t) => {
  const label = createLabel();
  installMeasuredPage(t, {
    drawerStyle: { direction: "rtl", borderRightWidth: "9px", borderLeftWidth: "1px" },
    textRects: new Map([[label, { left: 148, right: 248, width: 100 }]])
  });

  const width = measureDrawerContentWidth({
    getBoundingClientRect: () => ({ left: 0, right: 264 }),
    querySelector: () => null,
    querySelectorAll: () => [label]
  }, 12);

  assert.equal(width, 16 + 100 + 12 + 1);
});

// The drawer's identity (a workspace switcher, say) is cut to the drawer's width when its name is longer, so the drawer
// reads it at the width its content wants.
function createIdentity({ natural, cut, start = 40, rightToLeft = false }) {
  const identity = {
    style: { width: "", maxWidth: "" },
    readings: [],
    getBoundingClientRect() {
      const width = identity.style.width === "max-content" && identity.style.maxWidth === "none" ? natural : cut;
      identity.readings.push(width);
      return rightToLeft ? { left: start - width, right: start, width } : { left: start, right: start + width, width };
    }
  };
  return identity;
}

test("a content-sized drawer fits its identity's natural width, padding included", (t) => {
  const label = createLabel();
  installMeasuredPage(t, {
    drawerStyle: { direction: "ltr", borderRightWidth: "1px", borderLeftWidth: "0px" },
    textRects: new Map([[label, { left: 112, right: 212, width: 100 }]])
  });
  const identity = createIdentity({ natural: 300, cut: 180 });
  const drawer = (shown) => ({
    getBoundingClientRect: () => ({ left: 40, right: 220 }),
    querySelector: (selector) => (selector === ".shell-layout__identity" && shown ? identity : null),
    querySelectorAll: () => [label]
  });

  // The identity's padding is its end space, so only the drawer's border follows it.
  assert.equal(measureDrawerContentWidth(drawer(true), 12), 300 + 1);
  assert.deepEqual(identity.readings, [300]);
  assert.deepEqual(identity.style, { width: "", maxWidth: "" }, "the identity's own width is set back");
  // A name shorter than the labels leaves the labels' width, and a drawer without an identity measures its labels.
  assert.equal(measureDrawerContentWidth({ ...drawer(true), querySelector: () => createIdentity({ natural: 90, cut: 90 }) }, 12),
    72 + 100 + 12 + 1);
  assert.equal(measureDrawerContentWidth(drawer(false), 12), 72 + 100 + 12 + 1);
  // An empty identity is hidden and has no width.
  assert.equal(measureDrawerContentWidth({ ...drawer(true), querySelector: () => createIdentity({ natural: 0, cut: 0 }) }, 12),
    72 + 100 + 12 + 1);
});

test("a right-to-left drawer measures its identity from its right edge", (t) => {
  installMeasuredPage(t, {
    drawerStyle: { direction: "rtl", borderRightWidth: "0px", borderLeftWidth: "1px" },
    textRects: new Map()
  });
  const identity = createIdentity({ natural: 280, cut: 200, start: 264, rightToLeft: true });
  const width = measureDrawerContentWidth({
    getBoundingClientRect: () => ({ left: 64, right: 264 }),
    querySelector: () => identity,
    querySelectorAll: () => []
  }, 12);

  assert.equal(width, 280 + 1);
});
