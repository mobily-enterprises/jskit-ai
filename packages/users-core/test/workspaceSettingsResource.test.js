import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { workspaceSettingsResource } from "../src/shared/schemas/resources/workspaceSettingsResource.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";

function parseBody(operation, payload = {}) {
  return validateOperationSection({
    operation,
    section: "body",
    value: payload
  });
}

test("workspace settings patch body normalizes valid payload before validation", () => {
  const parsed = parseBody(workspaceSettingsResource.operations.patch, {
    name: "  Team Mercury  ",
    avatarUrl: "https://example.com/avatar.png",
    color: "#0f6b54",
    invitesEnabled: false
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.fieldErrors, {});
  assert.deepEqual(parsed.value, {
    name: "Team Mercury",
    avatarUrl: "https://example.com/avatar.png",
    color: "#0F6B54",
    invitesEnabled: false
  });
});

test("workspace settings patch body validates avatar URL protocol", () => {
  const parsed = parseBody(workspaceSettingsResource.operations.patch, {
    avatarUrl: "ftp://example.com/avatar.png"
  });

  assert.equal(parsed.ok, false);
  assert.equal(
    parsed.fieldErrors.avatarUrl,
    "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
  );
});

test("workspace settings patch body keeps max-length name rule", () => {
  const parsed = parseBody(workspaceSettingsResource.operations.patch, {
    name: "x".repeat(161)
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.name, "Workspace name must be at most 160 characters.");
});

test("workspace settings create body requires full-write fields", () => {
  const parsed = parseBody(workspaceSettingsResource.operations.create, {
    name: "Mercury Workspace"
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.color, "Workspace color is required.");
  assert.equal(parsed.fieldErrors.invitesEnabled, "invitesEnabled is required.");
});

test("workspace settings output normalizes raw service payloads", () => {
  const normalized = workspaceSettingsResource.operations.view.output.normalize({
    workspace: {
      id: "7",
      slug: "  mercury  ",
      name: "  Mercury Workspace  ",
      ownerUserId: "9",
      avatarUrl: "  https://example.com/avatar.png  ",
      color: "#0f6b54"
    },
    settings: {
      invitesEnabled: false
    },
    roleCatalog: createWorkspaceRoleCatalog()
  });

  assert.deepEqual(normalized, {
    workspace: {
      id: 7,
      slug: "mercury",
      name: "Mercury Workspace",
      ownerUserId: 9,
      avatarUrl: "https://example.com/avatar.png",
      color: "#0F6B54"
    },
    settings: {
      invitesEnabled: false,
      invitesAvailable: true,
      invitesEffective: false
    },
    roleCatalog: {
      collaborationEnabled: true,
      defaultInviteRole: "member",
      roles: [
        {
          id: "owner",
          assignable: false,
          permissions: ["*"]
        },
        {
          id: "admin",
          assignable: true,
          permissions: [
            "workspace.roles.view",
            "workspace.settings.view",
            "workspace.settings.update",
            "workspace.members.view",
            "workspace.members.invite",
            "workspace.members.manage",
            "workspace.invites.revoke"
          ]
        },
        {
          id: "member",
          assignable: true,
          permissions: ["workspace.settings.view"]
        }
      ],
      assignableRoleIds: ["admin", "member"]
    }
  });
});
