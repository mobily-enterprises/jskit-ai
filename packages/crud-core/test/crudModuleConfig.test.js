import assert from "node:assert/strict";
import test from "node:test";
import { resolveCrudSurfacePolicyFromAppConfig } from "../src/server/crudModuleConfig.js";

test("resolveCrudSurfacePolicyFromAppConfig explains missing workspace surfaces for workspace-capable tenancy", () => {
  assert.throws(
    () =>
      resolveCrudSurfacePolicyFromAppConfig(
        {
          namespace: "users",
          surface: "admin",
          ownershipFilter: "public",
          relativePath: "/users"
        },
        {
          tenancyMode: "personal",
          surfaceDefaultId: "home",
          surfaceDefinitions: {
            home: {
              id: "home",
              enabled: true,
              requiresAuth: false,
              requiresWorkspace: false
            }
          }
        },
        {
          context: "UsersProvider"
        }
      ),
    /UsersProvider cannot resolve surface "admin".*@jskit-ai\/workspaces-core.*"app" and "admin" surfaces/s
  );
});
