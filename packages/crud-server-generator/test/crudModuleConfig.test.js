import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrudConfig,
  resolveCrudSurfacePolicy,
  resolveCrudConfigFromModules,
  resolveCrudConfigsFromModules
} from "../src/server/crudModuleConfig.js";

test("resolveCrudConfig throws when namespace is missing", () => {
  assert.throws(
    () => resolveCrudConfig({}),
    /requires a non-empty namespace/
  );
});

test("resolveCrudConfig normalizes namespaced public settings", () => {
  const config = resolveCrudConfig({
    namespace: "CRM Team",
    ownershipFilter: "public"
  });

  assert.equal(config.namespace, "crm-team");
  assert.equal(config.ownershipFilter, "public");
  assert.equal(config.workspaceScoped, false);
  assert.equal(config.namespacePath, "/crm-team");
  assert.equal(config.relativePath, "/crm-team");
  assert.equal(config.apiBasePath, "/api/crm-team");
  assert.equal(config.tableName, "crud_crm_team");
  assert.equal(config.actionIdPrefix, "crud.crm_team");
  assert.equal(config.contributorId, "crud.crm_team");
  assert.equal(config.domain, "crud");
});

test("resolveCrudConfigsFromModules returns only crud module entries", () => {
  const configs = resolveCrudConfigsFromModules({
    "crud.customers": {
      module: "crud",
      namespace: "customers",
      ownershipFilter: "workspace"
    },
    "crud.dragons": {
      module: "crud",
      namespace: "dragons",
      ownershipFilter: "public"
    },
    "users.default": {
      module: "users",
      namespace: "ignored"
    }
  });

  assert.deepEqual(configs.map((entry) => entry.namespace), ["customers", "dragons"]);
  assert.deepEqual(configs.map((entry) => entry.ownershipFilter), ["workspace", "public"]);
});

test("resolveCrudConfigFromModules resolves explicit namespace", () => {
  const config = resolveCrudConfigFromModules(
    {
      "crud.customers": {
        module: "crud",
        namespace: "customers",
        ownershipFilter: "workspace"
      },
      "crud.dragons": {
        module: "crud",
        namespace: "dragons",
        ownershipFilter: "workspace_user"
      }
    },
    {
      namespace: "dragons"
    }
  );

  assert.ok(config);
  assert.equal(config.namespace, "dragons");
  assert.equal(config.ownershipFilter, "workspace_user");
});

test("resolveCrudConfigFromModules returns null without namespace when multiple crud entries exist", () => {
  const config = resolveCrudConfigFromModules({
    "crud.customers": {
      module: "crud",
      namespace: "customers",
      ownershipFilter: "workspace"
    },
    "crud.dragons": {
      module: "crud",
      namespace: "dragons",
      ownershipFilter: "workspace"
    }
  });

  assert.equal(config, null);
});

test("resolveCrudConfigsFromModules rejects duplicate normalized namespaces", () => {
  assert.throws(
    () =>
      resolveCrudConfigsFromModules({
        "crud.customers": {
          module: "crud",
          namespace: "customers",
          ownershipFilter: "workspace"
        },
        "crud.customers-copy": {
          module: "crud",
          namespace: "Customers",
          ownershipFilter: "public"
        }
      }),
    /Duplicate CRUD namespace/
  );
});

test("resolveCrudConfigsFromModules rejects module entries without namespace", () => {
  assert.throws(
    () =>
      resolveCrudConfigsFromModules({
        "crud.invalid": {
          module: "crud",
          namespace: "",
          ownershipFilter: "workspace"
        }
      }),
    /requires a non-empty namespace/
  );
});

test("resolveCrudSurfacePolicy resolves auto ownership filter from workspace surface metadata", () => {
  const policy = resolveCrudSurfacePolicy(
    {
      surface: "admin",
      ownershipFilter: "auto",
      relativePath: "/crm/customers"
    },
    {
      surfaceDefinitions: {
        admin: { requiresWorkspace: true, requiresAuth: true, enabled: true }
      },
      defaultSurfaceId: "admin"
    }
  );

  assert.equal(policy.surfaceId, "admin");
  assert.equal(policy.ownershipFilter, "workspace");
  assert.equal(policy.workspaceScoped, true);
  assert.equal(policy.relativePath, "/crm/customers");
});

test("resolveCrudSurfacePolicy resolves auto ownership filter from auth-only surface metadata", () => {
  const policy = resolveCrudSurfacePolicy(
    {
      surface: "console",
      ownershipFilter: "auto",
      relativePath: "/crm/customers"
    },
    {
      surfaceDefinitions: {
        console: { requiresWorkspace: false, requiresAuth: true, enabled: true }
      },
      defaultSurfaceId: "console"
    }
  );

  assert.equal(policy.surfaceId, "console");
  assert.equal(policy.ownershipFilter, "user");
  assert.equal(policy.workspaceScoped, false);
});

test("resolveCrudSurfacePolicy rejects explicit workspace ownership filter on non-workspace surfaces", () => {
  assert.throws(
    () =>
      resolveCrudSurfacePolicy(
        {
          surface: "console",
          ownershipFilter: "workspace",
          relativePath: "/crm/customers"
        },
        {
          surfaceDefinitions: {
            console: { requiresWorkspace: false, requiresAuth: true, enabled: true }
          }
        }
      ),
    /requires a workspace-enabled surface/
  );
});

test("resolveCrudSurfacePolicy rejects unknown or disabled surfaces", () => {
  assert.throws(
    () =>
      resolveCrudSurfacePolicy(
        {
          surface: "missing",
          ownershipFilter: "auto",
          relativePath: "/crm/customers"
        },
        {
          surfaceDefinitions: {
            console: { requiresWorkspace: false, requiresAuth: true, enabled: true }
          }
        }
      ),
    /cannot resolve surface "missing"/
  );

  assert.throws(
    () =>
      resolveCrudSurfacePolicy(
        {
          surface: "console",
          ownershipFilter: "auto",
          relativePath: "/crm/customers"
        },
        {
          surfaceDefinitions: {
            console: { requiresWorkspace: false, requiresAuth: true, enabled: false }
          }
        }
      ),
    /surface "console" is disabled/
  );
});
