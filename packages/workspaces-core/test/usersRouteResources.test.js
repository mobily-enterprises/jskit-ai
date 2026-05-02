import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/_testable";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { workspaceMembersResource } from "../src/shared/resources/workspaceMembersResource.js";
import { workspaceResource } from "../src/shared/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../src/shared/resources/workspaceSettingsResource.js";

function assertResourceShape(resource, label) {
  assert.ok(resource, `${label} resource must exist.`);
  assert.equal(typeof resource, "object", `${label} resource must be an object.`);
  assert.equal(typeof resource.namespace, "string", `.namespace must be a string.`);

  for (const operationName of ["view", "list", "create", "replace", "patch"]) {
    const operation = resource.operations?.[operationName];
    assert.equal(typeof operation, "object", `${label}.operations.${operationName} must exist.`);
    assert.equal(typeof operation.method, "string", `${label}.operations.${operationName}.method must exist.`);
    const resolvedMessages =
      operation?.messages && typeof operation.messages === "object"
        ? operation.messages
        : resource?.messages || resource?.operationMessages;
    assert.equal(
      typeof resolvedMessages,
      "object",
      `${label}.operations.${operationName} must resolve messages from operation.messages or resource.messages.`
    );
    assert.equal(
      typeof resolveStructuredSchemaTransportSchema(operation.output, {
        context: `${label}.operations.${operationName}.output`,
        defaultMode: "replace"
      }),
      "object",
      `${label}.operations.${operationName} payload schema is required.`
    );
  }

  assert.equal(typeof resource.operations.create.body?.schema, "object", `${label}.operations.create.body.schema is required.`);
  assert.equal(typeof resource.operations.replace.body?.schema, "object", `${label}.operations.replace.body.schema is required.`);
  assert.equal(typeof resource.operations.patch.body?.schema, "object", `${label}.operations.patch.body.schema is required.`);

  const requiredMetadata = deriveResourceRequiredMetadata(resource);
  assert.ok(Array.isArray(requiredMetadata.create), `${label}.derivedRequired.create must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.replace), `${label}.derivedRequired.replace must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.patch), `${label}.derivedRequired.patch must be an array.`);
}

test("workspace resources expose canonical validators", () => {
  const resourcesByLabel = {
    workspace: workspaceResource,
    workspaceSettings: workspaceSettingsResource
  };

  for (const [label, resource] of Object.entries(resourcesByLabel)) {
    assertResourceShape(resource, label);
  }
});

test("workspace settings and invite operations expose canonical validators", () => {
  const operationSpecs = [
    { label: "workspaceMembers.rolesList", operation: workspaceMembersResource.operations.rolesList },
    { label: "workspaceMembers.membersList", operation: workspaceMembersResource.operations.membersList },
    { label: "workspaceMembers.updateMemberRole", operation: workspaceMembersResource.operations.updateMemberRole },
    { label: "workspaceMembers.removeMember", operation: workspaceMembersResource.operations.removeMember },
    { label: "workspaceMembers.invitesList", operation: workspaceMembersResource.operations.invitesList },
    { label: "workspaceMembers.createInvite", operation: workspaceMembersResource.operations.createInvite },
    { label: "workspaceMembers.revokeInvite", operation: workspaceMembersResource.operations.revokeInvite },
    { label: "workspaceMembers.redeemInvite", operation: workspaceMembersResource.operations.redeemInvite }
  ];

  for (const { label, operation } of operationSpecs) {
    assert.equal(typeof operation?.method, "string", `${label}.method must exist.`);
    assert.equal(
      typeof resolveStructuredSchemaTransportSchema(operation?.output, {
        context: `${label}.output`,
        defaultMode: "replace"
      }),
      "object",
      `${label}.output transport schema must exist.`
    );
    if (operation?.body) {
      assert.equal(typeof operation.body.schema, "object", `${label}.body.schema must exist.`);
    }
    if (operation?.params) {
      assert.equal(typeof operation.params.schema, "object", `${label}.params.schema must exist.`);
    }
    if (operation?.query) {
      assert.equal(typeof operation.query.schema, "object", `${label}.query.schema must exist.`);
    }
  }
});

test("workspaces-core no longer uses a workspace schema helper that exposes raw schema leaves", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const workspaceRoutesFilePath = path.join(packageRoot, "src", "server", "common", "routes", "workspaceRoutes.js");
  assert.equal(existsSync(workspaceRoutesFilePath), false, "workspaceRoutes.js must not exist.");
});

test("workspaces-core route validators do not live under src/shared/schema", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const sharedSchemaDirPath = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(sharedSchemaDirPath), false, "src/shared/schema must not exist.");
});
