import assert from "node:assert/strict";
import test from "node:test";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { useAccess } from "../src/client/composables/useAccess.js";

async function renderAccess(placementContext, options = {}) {
  let access = null;
  const app = createSSRApp({
    setup() {
      access = useAccess(options);
      return () => h("div");
    }
  });
  app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, {
    getContext: () => placementContext,
    getPlacements: () => [],
    setContext: () => placementContext,
    subscribe: () => () => {},
    getRevision: () => 0
  });
  await renderToString(app);
  return access;
}

test("useAccess reads permissions from the placement context only", async () => {
  const access = await renderAccess({ permissions: ["workspace.members.view"] });

  assert.deepEqual(access.permissions.value, ["workspace.members.view"]);
  assert.equal(access.can("workspace.members.view"), true);
  assert.equal(access.canAny(["workspace.members.manage", "workspace.members.view"]), true);
  assert.equal(access.canAll(["workspace.members.manage", "workspace.members.view"]), false);
  assert.equal(access.awaitingPlacementPermissions.value, false);
  assert.equal(access.permissionsUnavailableError.value, "");
  assert.deepEqual(Object.keys(access).sort(), [
    "accessMode",
    "accessRequired",
    "awaitingPlacementPermissions",
    "can",
    "canAll",
    "canAny",
    "permissions",
    "permissionsUnavailableError"
  ]);
});

test("useAccess awaits placement permissions until the context carries them", async () => {
  const access = await renderAccess({});

  assert.deepEqual(access.permissions.value, []);
  assert.equal(access.can("workspace.members.view"), false);
  assert.equal(access.awaitingPlacementPermissions.value, true);
  assert.equal(access.permissionsUnavailableError.value, "Permissions are unavailable in placement context.");
});

test("useAccess reports nothing when disabled", async () => {
  const access = await renderAccess({}, { enabled: false });

  assert.equal(access.awaitingPlacementPermissions.value, false);
  assert.equal(access.permissionsUnavailableError.value, "");
});
