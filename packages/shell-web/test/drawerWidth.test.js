import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SHELL_DRAWER_WIDTH,
  DEFAULT_SHELL_RAIL_WIDTH,
  normalizeShellDrawerWidth,
  normalizeShellRailWidth,
  resolveContentAwareDrawerWidth
} from "../src/client/support/drawerWidth.js";

test("content-aware drawer width includes the rendered label start, width, and 10px end gap", () => {
  assert.equal(
    resolveContentAwareDrawerWidth([
      { logicalStart: 72, textWidth: 40 },
      { logicalStart: 72, textWidth: 78 }
    ]),
    160
  );
  assert.equal(
    resolveContentAwareDrawerWidth([
      { logicalStart: 72, textWidth: 99.015625 }
    ]),
    182
  );
});

test("drawer and rail widths have stable defaults and bounded overrides", () => {
  assert.equal(normalizeShellDrawerWidth(null), DEFAULT_SHELL_DRAWER_WIDTH);
  assert.equal(normalizeShellDrawerWidth(180), 180);
  assert.equal(normalizeShellDrawerWidth(1000), 360);
  assert.equal(normalizeShellRailWidth(null), DEFAULT_SHELL_RAIL_WIDTH);
  assert.equal(normalizeShellRailWidth(96), 96);
  assert.equal(normalizeShellRailWidth(20), 48);
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
