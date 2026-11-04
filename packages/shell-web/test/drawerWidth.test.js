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
    querySelectorAll: () => [label]
  }, 12);

  assert.equal(width, 16 + 100 + 12 + 1);
});
