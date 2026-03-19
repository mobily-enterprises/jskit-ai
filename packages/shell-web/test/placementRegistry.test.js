import assert from "node:assert/strict";
import test from "node:test";
import { createPlacementRegistry } from "../src/client/placement/registry.js";

test("placement registry stores unique entries and builds immutable array", () => {
  const registry = createPlacementRegistry();

  const firstAdded = registry.addPlacement({
    id: "example.profile",
    slot: "app.top-right",
    surface: "*",
    componentToken: "example.profile.component"
  });
  const duplicateAdded = registry.addPlacement({
    id: "example.profile",
    slot: "app.top-right",
    surface: "*",
    componentToken: "example.profile.component.duplicate"
  });

  assert.equal(firstAdded, true);
  assert.equal(duplicateAdded, false);
  assert.equal(registry.hasPlacement("example.profile"), true);

  const placements = registry.build();
  assert.equal(Array.isArray(placements), true);
  assert.equal(placements.length, 1);
  assert.equal(placements[0].componentToken, "example.profile.component");
});

test("placement registry rejects raw non-global surface ids", () => {
  const registry = createPlacementRegistry();

  assert.throws(
    () =>
      registry.addPlacement({
        id: "example.invalid",
        slot: "app.top-right",
        surface: "admin",
        componentToken: "example.invalid.component"
      }),
    /targetSurfaceRole/
  );
});
