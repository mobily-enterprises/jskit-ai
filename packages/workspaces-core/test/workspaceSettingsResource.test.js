import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { resolveWorkspaceThemePalettes } from "@jskit-ai/workspaces-core/shared/settings";
import {
  WORKSPACE_SETTINGS_FIELD_KEYS,
  workspaceSettingsResource
} from "../src/shared/resources/workspaceSettingsResource.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";

function createRoleCatalog() {
  return createWorkspaceRoleCatalog({
    roleCatalog: {
      workspace: {
        defaultInviteRole: "member"
      },
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
    section: "body",
    value: payload
  });
}

test("workspace settings patch body validates valid payload without reshaping it", async () => {
  const parsed = await parseBody(workspaceSettingsResource.operations.patch, {
    lightPrimaryColor: "#0f6b54",
    lightSecondaryColor: "#0b4d3c",
    lightSurfaceColor: "#eef5f3",
    lightSurfaceVariantColor: "#ddeae7",
    darkPrimaryColor: "#123456",
    darkSecondaryColor: "#234567",
    darkSurfaceColor: "#345678",
    darkSurfaceVariantColor: "#456789",
    invitesEnabled: false
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.fieldErrors, {});
  assert.deepEqual(parsed.value, {
    lightPrimaryColor: "#0f6b54",
    lightSecondaryColor: "#0b4d3c",
    lightSurfaceColor: "#eef5f3",
    lightSurfaceVariantColor: "#ddeae7",
    darkPrimaryColor: "#123456",
    darkSecondaryColor: "#234567",
    darkSurfaceColor: "#345678",
    darkSurfaceVariantColor: "#456789",
    invitesEnabled: false
  });
});

test("workspace settings patch body rejects unknown fields", async () => {
  const parsed = await parseBody(workspaceSettingsResource.operations.patch, {
    avatarUrl: "https://example.com/avatar.png"
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.avatarUrl, "string");
});

test("workspace settings create body requires full-write fields", async () => {
  const parsed = await parseBody(workspaceSettingsResource.operations.create, {});

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.lightPrimaryColor, "Light primary color is required.");
  assert.equal(parsed.fieldErrors.lightSecondaryColor, "Light secondary color is required.");
  assert.equal(parsed.fieldErrors.lightSurfaceColor, "Light surface color is required.");
  assert.equal(parsed.fieldErrors.lightSurfaceVariantColor, "Light surface variant color is required.");
  assert.equal(parsed.fieldErrors.darkPrimaryColor, "Dark primary color is required.");
  assert.equal(parsed.fieldErrors.darkSecondaryColor, "Dark secondary color is required.");
  assert.equal(parsed.fieldErrors.darkSurfaceColor, "Dark surface color is required.");
  assert.equal(parsed.fieldErrors.darkSurfaceVariantColor, "Dark surface variant color is required.");
  assert.equal(parsed.fieldErrors.invitesEnabled, "invitesEnabled is required.");
});

test("workspace settings output schema accepts already-shaped service payloads", () => {
  const outputSchema = resolveStructuredSchemaTransportSchema(workspaceSettingsResource.operations.view.output, {
    context: "workspaceSettings.view.output",
    defaultMode: "replace"
  });
  const expectedTheme = resolveWorkspaceThemePalettes({
    lightPrimaryColor: "#0F6B54"
  });
  const payload = {
    workspace: {
      id: "7",
      slug: "mercury",
      ownerUserId: "9"
    },
    settings: {
      lightPrimaryColor: "#0F6B54",
      lightSecondaryColor: expectedTheme.light.secondaryColor,
      lightSurfaceColor: expectedTheme.light.surfaceColor,
      lightSurfaceVariantColor: expectedTheme.light.surfaceVariantColor,
      darkPrimaryColor: expectedTheme.dark.color,
      darkSecondaryColor: expectedTheme.dark.secondaryColor,
      darkSurfaceColor: expectedTheme.dark.surfaceColor,
      darkSurfaceVariantColor: expectedTheme.dark.surfaceVariantColor,
      invitesEnabled: false,
      invitesAvailable: true,
      invitesEffective: false
    },
    roleCatalog: createRoleCatalog()
  };

  assert.equal(outputSchema.type, "object");
  assert.equal(outputSchema.additionalProperties, false);
  assert.equal(typeof outputSchema.properties.workspace, "object");
  assert.equal(typeof outputSchema.properties.settings, "object");
  assert.equal(typeof outputSchema.properties.roleCatalog, "object");
  assert.equal(outputSchema.properties.settings.properties.lightPrimaryColor.type, "string");
  assert.equal(payload.settings.lightPrimaryColor, "#0F6B54");
});

async function importWithIdentity(url, identity) {
  return import(`${url.href}?identity=${identity}`);
}

test("workspace settings key exports stay stable across module identities", async () => {
  const workspaceModuleUrl = new URL("../src/shared/resources/workspaceSettingsResource.js", import.meta.url);

  const workspaceA = await importWithIdentity(workspaceModuleUrl, "workspace-a");
  const workspaceB = await importWithIdentity(workspaceModuleUrl, "workspace-b");

  assert.deepEqual(workspaceA.WORKSPACE_SETTINGS_FIELD_KEYS, workspaceB.WORKSPACE_SETTINGS_FIELD_KEYS);
  assert.deepEqual(workspaceA.WORKSPACE_SETTINGS_FIELD_KEYS, WORKSPACE_SETTINGS_FIELD_KEYS);
  assert.ok(Object.isFrozen(workspaceA.WORKSPACE_SETTINGS_FIELD_KEYS));
});
