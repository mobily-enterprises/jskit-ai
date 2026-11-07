import assert from "node:assert/strict";
import test from "node:test";
import { bootClientModules } from "@jskit-ai/kernel/client/moduleBootstrap";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import { resolvePageParent } from "../src/client/navigation/shellNavigationRuntime.js";

// A package's page (package.json jskit.metadata.ui.routes) is one record at the top level, so the shell's Up reads the
// parent it declares; one that declares none is top-level, with no Up.
test("Up reads the parent a package's surface route declares", async () => {
  const routes = [];
  await bootClientModules({
    clientModules: [
      {
        packageId: "@example/manage",
        packageMetadataUiRoutes: [
          { id: "manage", path: "/app/manage", scope: "surface", surface: "app", componentKey: "page" },
          { id: "manage.view", path: "/app/manage/:view", scope: "surface", surface: "app", componentKey: "page", meta: { jskit: { parent: "/manage" } } },
          { id: "account", path: "/account", scope: "global", componentKey: "page", meta: { jskit: { parent: { surface: "app", path: "/" } } } }
        ],
        module: { routeComponents: { page: {} } }
      }
    ],
    router: { addRoute: (route) => routes.push(route), getRoutes: () => [...routes] },
    surfaceRuntime: createSurfaceRuntime({
      allMode: "all",
      surfaces: { app: { id: "app", pagesRoot: "app", enabled: true } },
      defaultSurfaceId: "app"
    }),
    surfaceMode: "all",
    logger: silentLogger
  });

  const parentOf = (path) => {
    const parent = resolvePageParent([routes.find((route) => route.path === path)]);
    return parent && { surface: parent.surface, path: parent.path };
  };
  assert.equal(parentOf("/app/manage"), null);
  assert.deepEqual(parentOf("/app/manage/:view"), { surface: "", path: "/manage" });
  assert.deepEqual(parentOf("/account"), { surface: "app", path: "/" });
});
