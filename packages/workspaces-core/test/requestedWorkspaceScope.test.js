import assert from "node:assert/strict";
import test from "node:test";
import { BOOTSTRAP_PATH } from "@jskit-ai/kernel/shared/surface/paths";
import { requestedWorkspaceScope } from "../src/server/support/workspaceRouteInput.js";

test("requestedWorkspaceScope reads the route's workspace slug", () => {
  const request = {
    params: { workspaceSlug: " Acme " },
    query: { workspaceSlug: "other" },
    routeOptions: { url: "/api/w/:workspaceSlug/contacts" }
  };

  assert.deepEqual(requestedWorkspaceScope(request), { workspaceSlug: "acme" });
});

test("requestedWorkspaceScope reads the bootstrap request's workspace query, and no other route's", () => {
  assert.equal(BOOTSTRAP_PATH, "/api/bootstrap");
  assert.deepEqual(requestedWorkspaceScope({ params: {}, query: { workspaceSlug: "Acme" }, routeOptions: { url: BOOTSTRAP_PATH } }), {
    workspaceSlug: "acme"
  });
  assert.deepEqual(requestedWorkspaceScope({ params: {}, query: { workspaceSlug: "acme" }, routeOptions: { url: "/api/session" } }), {});
  assert.deepEqual(requestedWorkspaceScope({ routeOptions: { url: BOOTSTRAP_PATH } }), {});
  assert.deepEqual(requestedWorkspaceScope({}), {});
});
