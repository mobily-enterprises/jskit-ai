import test from "node:test";
import assert from "node:assert/strict";
import { resolveContactsConfig } from "../src/shared/contacts/contactsModuleConfig.js";

test("resolveContactsConfig returns workspace defaults", () => {
  const config = resolveContactsConfig({});

  assert.equal(config.namespace, "");
  assert.equal(config.visibility, "workspace");
  assert.equal(config.workspaceScoped, true);
  assert.equal(config.relativePath, "/crud");
  assert.equal(config.apiBasePath, "/api/w/:workspaceSlug/workspace/crud");
  assert.equal(config.tableName, "crud");
  assert.equal(config.actionIdPrefix, "crud");
  assert.equal(config.contributorId, "crud");
});

test("resolveContactsConfig normalizes namespaced public settings", () => {
  const config = resolveContactsConfig({
    namespace: "CRM Team",
    visibility: "public"
  });

  assert.equal(config.namespace, "crm-team");
  assert.equal(config.visibility, "public");
  assert.equal(config.workspaceScoped, false);
  assert.equal(config.relativePath, "/crm-team/crud");
  assert.equal(config.apiBasePath, "/api/crm-team/crud");
  assert.equal(config.tableName, "crud_crm_team");
  assert.equal(config.actionIdPrefix, "crud.crm_team");
  assert.equal(config.contributorId, "crud.crm_team");
});
