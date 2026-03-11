import test from "node:test";
import assert from "node:assert/strict";
import { resolveContactsConfig } from "../src/shared/contacts/contactsModuleConfig.js";

test("resolveContactsConfig returns workspace defaults", () => {
  const config = resolveContactsConfig({});

  assert.equal(config.namespace, "");
  assert.equal(config.visibility, "workspace");
  assert.equal(config.workspaceScoped, true);
  assert.equal(config.relativePath, "/contacts");
  assert.equal(config.apiBasePath, "/api/w/:workspaceSlug/workspace/contacts");
  assert.equal(config.tableName, "contacts");
  assert.equal(config.actionIdPrefix, "contacts");
  assert.equal(config.contributorId, "crud.contacts");
});

test("resolveContactsConfig normalizes namespaced public settings", () => {
  const config = resolveContactsConfig({
    namespace: "CRM Team",
    visibility: "public"
  });

  assert.equal(config.namespace, "crm-team");
  assert.equal(config.visibility, "public");
  assert.equal(config.workspaceScoped, false);
  assert.equal(config.relativePath, "/crm-team/contacts");
  assert.equal(config.apiBasePath, "/api/crm-team/contacts");
  assert.equal(config.tableName, "crm_team_contacts");
  assert.equal(config.actionIdPrefix, "contacts.crm_team");
  assert.equal(config.contributorId, "crud.contacts.crm_team");
});
