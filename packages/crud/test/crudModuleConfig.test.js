import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrudConfig,
  resolveCrudConfigFromModules,
  resolveCrudConfigsFromModules
} from "../src/shared/crud/crudModuleConfig.js";

test("resolveCrudConfig throws when namespace is missing", () => {
  assert.throws(
    () => resolveCrudConfig({}),
    /requires a non-empty namespace/
  );
});

test("resolveCrudConfig normalizes namespaced public settings", () => {
  const config = resolveCrudConfig({
    namespace: "CRM Team",
    visibility: "public"
  });

  assert.equal(config.namespace, "crm-team");
  assert.equal(config.visibility, "public");
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
      visibility: "workspace"
    },
    "crud.dragons": {
      module: "crud",
      namespace: "dragons",
      visibility: "public"
    },
    "users.default": {
      module: "users",
      namespace: "ignored"
    }
  });

  assert.deepEqual(configs.map((entry) => entry.namespace), ["customers", "dragons"]);
  assert.deepEqual(configs.map((entry) => entry.visibility), ["workspace", "public"]);
});

test("resolveCrudConfigFromModules resolves explicit namespace", () => {
  const config = resolveCrudConfigFromModules(
    {
      "crud.customers": {
        module: "crud",
        namespace: "customers",
        visibility: "workspace"
      },
      "crud.dragons": {
        module: "crud",
        namespace: "dragons",
        visibility: "workspace_user"
      }
    },
    {
      namespace: "dragons"
    }
  );

  assert.ok(config);
  assert.equal(config.namespace, "dragons");
  assert.equal(config.visibility, "workspace_user");
});

test("resolveCrudConfigFromModules returns null without namespace when multiple crud entries exist", () => {
  const config = resolveCrudConfigFromModules({
    "crud.customers": {
      module: "crud",
      namespace: "customers",
      visibility: "workspace"
    },
    "crud.dragons": {
      module: "crud",
      namespace: "dragons",
      visibility: "workspace"
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
          visibility: "workspace"
        },
        "crud.customers-copy": {
          module: "crud",
          namespace: "Customers",
          visibility: "public"
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
          visibility: "workspace"
        }
      }),
    /requires a non-empty namespace/
  );
});
