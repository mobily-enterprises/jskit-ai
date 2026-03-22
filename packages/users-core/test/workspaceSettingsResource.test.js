import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import "../test-support/registerDefaultSettingsFields.js";
import { resolveWorkspaceThemePalette } from "../src/shared/settings.js";
import { workspaceSettingsResource } from "../src/shared/resources/workspaceSettingsResource.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";

function createRoleCatalog() {
  return createWorkspaceRoleCatalog({
    workspaceRoles: {
      defaultInviteRole: "member",
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        },
        admin: {
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
        member: {
          assignable: true,
          permissions: ["workspace.settings.view"]
        }
      }
    }
  });
}

function parseBody(operation, payload = {}) {
  return validateOperationSection({
    operation,
    section: "bodyValidator",
    value: payload
  });
}

test("workspace settings patch body normalizes valid payload before validation", () => {
  const parsed = parseBody(workspaceSettingsResource.operations.patch, {
    name: "  Team Mercury  ",
    avatarUrl: "https://example.com/avatar.png",
    color: "#0f6b54",
    secondaryColor: "#0b4d3c",
    surfaceColor: "#eef5f3",
    surfaceVariantColor: "#ddeae7",
    invitesEnabled: false
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.fieldErrors, {});
  assert.deepEqual(parsed.value, {
    name: "Team Mercury",
    avatarUrl: "https://example.com/avatar.png",
    color: "#0F6B54",
    secondaryColor: "#0B4D3C",
    surfaceColor: "#EEF5F3",
    surfaceVariantColor: "#DDEAE7",
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
  assert.equal(parsed.fieldErrors.secondaryColor, "Secondary color is required.");
  assert.equal(parsed.fieldErrors.surfaceColor, "Surface color is required.");
  assert.equal(parsed.fieldErrors.surfaceVariantColor, "Surface variant color is required.");
  assert.equal(parsed.fieldErrors.invitesEnabled, "invitesEnabled is required.");
});

test("workspace settings output normalizes raw service payloads", () => {
  const expectedTheme = resolveWorkspaceThemePalette({
    color: "#0F6B54"
  });
  const normalized = workspaceSettingsResource.operations.view.outputValidator.normalize({
    workspace: {
      id: "7",
      slug: "  mercury  ",
      ownerUserId: "9"
    },
    settings: {
      name: "  Mercury Workspace  ",
      avatarUrl: "  https://example.com/avatar.png  ",
      color: "#0f6b54",
      invitesEnabled: false
    },
    roleCatalog: createRoleCatalog()
  });

  assert.deepEqual(normalized, {
    workspace: {
      id: 7,
      slug: "mercury",
      ownerUserId: 9
    },
    settings: {
      name: "Mercury Workspace",
      avatarUrl: "https://example.com/avatar.png",
      color: "#0F6B54",
      secondaryColor: expectedTheme.secondaryColor,
      surfaceColor: expectedTheme.surfaceColor,
      surfaceVariantColor: expectedTheme.surfaceVariantColor,
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
