import assert from "node:assert/strict";
import test from "node:test";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { workspaceInvitesResource } from "../src/shared/resources/workspaceInvitesResource.js";
import { workspaceMembershipsResource } from "../src/shared/resources/workspaceMembershipsResource.js";

function parseBody(operation, payload = {}) {
  return validateOperationSection({
    operation,
    section: "body",
    value: payload
  });
}

test("workspace internal CRUD resources expose canonical derived operation sets", () => {
  const resources = {
    workspaceMemberships: workspaceMembershipsResource,
    workspaceInvites: workspaceInvitesResource
  };

  for (const [label, resource] of Object.entries(resources)) {
    assert.deepEqual(Object.keys(resource.operations), ["list", "view", "create", "patch"]);
    assert.equal(typeof resource.operations.create.body?.schema, "object", `${label}.operations.create.body.schema is required.`);
    assert.equal(typeof resource.operations.patch.body?.schema, "object", `${label}.operations.patch.body.schema is required.`);
    assert.equal(
      typeof resolveStructuredSchemaTransportSchema(resource.operations.view.output, {
        context: `${label}.operations.view.output`,
        defaultMode: "replace"
      }),
      "object",
      `${label}.operations.view.output transport schema is required.`
    );
  }
});

test("workspace memberships derived bodies accept normalized internal writes", async () => {
  const create = await parseBody(workspaceMembershipsResource.operations.create, {
    workspaceId: "7",
    userId: "9",
    roleSid: "OWNER",
    status: "ACTIVE",
    createdAt: "2026-05-02T10:11:12.000Z",
    updatedAt: "2026-05-02T10:11:12.000Z"
  });
  assert.equal(create.ok, true);
  assert.equal(String(create.value.workspaceId), "7");
  assert.equal(String(create.value.userId), "9");
  assert.equal(create.value.roleSid, "OWNER");
  assert.equal(create.value.status, "ACTIVE");
  assert.equal(typeof create.value.createdAt, "object");
  assert.equal(typeof create.value.updatedAt, "object");

  const patch = await parseBody(workspaceMembershipsResource.operations.patch, {
    roleSid: "ADMIN",
    status: "ACTIVE",
    updatedAt: "2026-05-02T10:11:12.000Z"
  });
  assert.equal(patch.ok, true);
  assert.equal(patch.value.roleSid, "ADMIN");
  assert.equal(patch.value.status, "ACTIVE");
  assert.equal(typeof patch.value.updatedAt, "object");
});

test("workspace invites derived bodies keep lifecycle fields available for internal writes", async () => {
  const create = await parseBody(workspaceInvitesResource.operations.create, {
    workspaceId: "7",
    email: "Invitee@Example.com",
    roleSid: "ADMIN",
    status: "PENDING",
    tokenHash: "  invite-token-hash  ",
    invitedByUserId: "9",
    expiresAt: "2026-05-10T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    createdAt: "2026-05-02T10:11:12.000Z",
    updatedAt: "2026-05-02T10:11:12.000Z"
  });
  assert.equal(create.ok, true);
  assert.equal(String(create.value.workspaceId), "7");
  assert.equal(create.value.email, "Invitee@Example.com");
  assert.equal(create.value.roleSid, "ADMIN");
  assert.equal(create.value.status, "PENDING");
  assert.equal(create.value.tokenHash, "invite-token-hash");
  assert.equal(String(create.value.invitedByUserId), "9");
  assert.equal(typeof create.value.createdAt, "object");
  assert.equal(typeof create.value.updatedAt, "object");

  const patch = await parseBody(workspaceInvitesResource.operations.patch, {
    status: "ACCEPTED",
    acceptedAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z"
  });
  assert.equal(patch.ok, true);
  assert.equal(patch.value.status, "ACCEPTED");
  assert.equal(typeof patch.value.acceptedAt, "object");
  assert.equal(typeof patch.value.updatedAt, "object");
});
