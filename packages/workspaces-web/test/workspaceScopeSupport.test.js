import assert from "node:assert/strict";
import test from "node:test";
import { computed, ref } from "vue";
import {
  createWorkspaceScopeSupport,
  readWorkspaceRouteScope
} from "../src/client/support/workspaceScopeSupport.js";

test("readWorkspaceRouteScope extracts workspace slug from the current dynamic surface path", () => {
  const scope = readWorkspaceRouteScope({
    placementContext: ref({
      surfaceConfig: {
        defaultSurfaceId: "app",
        surfacesById: {
          app: {
            id: "app",
            routeBase: "w/[workspaceSlug]",
            requiresWorkspace: true
          },
          admin: {
            id: "admin",
            routeBase: "w/[workspaceSlug]/admin",
            requiresWorkspace: true
          }
        }
      }
    }),
    currentSurfaceId: computed(() => "admin"),
    routePath: computed(() => "/w/acme/admin/settings")
  });

  assert.deepEqual(scope, {
    workspaceSlug: "acme"
  });
});

test("workspace scope support exposes the shared route-scope reader", () => {
  const support = createWorkspaceScopeSupport();

  assert.equal(typeof support.available, "boolean");
  assert.equal(typeof support.readRouteScope, "function");
  assert.deepEqual(
    support.readRouteScope({
      placementContext: ref({
        surfaceConfig: {
          defaultSurfaceId: "app",
          surfacesById: {
            app: {
              id: "app",
              routeBase: "w/[workspaceSlug]",
              requiresWorkspace: true
            }
          }
        }
      }),
      currentSurfaceId: computed(() => "app"),
      routePath: computed(() => "/w/dogandgroom")
    }),
    {
      workspaceSlug: "dogandgroom"
    }
  );
});
