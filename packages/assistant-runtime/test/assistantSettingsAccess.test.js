import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/services/assistantConfigService.js";

function createSettingsRows() {
  const rows = new Map();
  const key = ({ targetSurfaceId, workspaceId }) => `${targetSurfaceId}:${workspaceId ?? ""}`;
  return Object.freeze({
    async findByScope(scope) {
      return rows.get(key(scope)) || null;
    },
    createDefaultRecord(scope) {
      return { ...scope, scopeKey: key(scope), settings: { systemPrompt: "" } };
    },
    async upsertByScope({ patch, ...scope }) {
      const record = { ...scope, scopeKey: key(scope), settings: { systemPrompt: patch.systemPrompt } };
      rows.set(key(scope), record);
      return record;
    }
  });
}

function createAppConfig(assistantServer) {
  return {
    surfaceDefinitions: {
      home: { enabled: true, requiresWorkspace: false, accessPolicyId: "authenticated" },
      ops: { enabled: true, requiresWorkspace: false, accessPolicyId: "authenticated" },
      admin: { enabled: true, requiresWorkspace: true, accessPolicyId: "workspace_member" },
      console: { enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
    },
    assistantSurfaces: {
      home: { settingsSurfaceId: "home", configScope: "global" },
      ops: { settingsSurfaceId: "console", configScope: "global" },
      admin: { settingsSurfaceId: "admin", configScope: "workspace" }
    },
    assistantServer
  };
}

function createSettings(assistantServer, { consoleOwnerIds = [] } = {}) {
  return createService({
    assistantConfigRepository: createSettingsRows(),
    consoleService: {
      async requireConsoleOwner(context) {
        if (!consoleOwnerIds.includes(context.actor.id)) {
          throw Object.assign(new Error("Console owner required."), { code: "console.ownerRequired" });
        }
      }
    },
    appConfig: createAppConfig(assistantServer),
    workspaceScopeSupport: { resolveWorkspace: () => ({ id: "3" }) }
  });
}

const employee = { actor: { id: "7" }, permissions: [] };

async function update(settings, targetSurfaceId, context) {
  return settings.updateSettings({ targetSurfaceId }, { systemPrompt: `Set by ${context.actor.id}` }, { context });
}

test("an employee can read but not change the instructions of a global assistant", async () => {
  const settings = createSettings({});
  assert.equal((await settings.getSettings({ targetSurfaceId: "home" }, { context: employee })).settings.systemPrompt, "");
  await assert.rejects(update(settings, "home", employee), {
    statusCode: 403,
    code: "assistant.runtime.settings.updateForbidden",
    message: "You do not have permission to change the assistant's instructions."
  });
  const admin = { actor: { id: "1" }, permissions: ["assistant.settings.update"] };
  assert.equal((await update(settings, "home", admin)).settings.systemPrompt, "Set by 1");
});

test("assistantServer.<surface>.settingsUpdatePermission names the permission that changes the instructions", async () => {
  const settings = createSettings({ home: { settingsUpdatePermission: "app.admin" } });
  await assert.rejects(update(settings, "home", { actor: { id: "7" }, permissions: ["assistant.settings.update"] }), {
    code: "assistant.runtime.settings.updateForbidden"
  });
  assert.equal((await update(settings, "home", { actor: { id: "1" }, permissions: ["app.admin"] })).settings.systemPrompt, "Set by 1");

  const open = createSettings({ home: { settingsUpdatePermission: { require: "authenticated" } } });
  assert.equal((await update(open, "home", employee)).settings.systemPrompt, "Set by 7");
});

test("a workspace assistant still needs workspace.settings.update, and a console assistant its console owner", async () => {
  const settings = createSettings({}, { consoleOwnerIds: ["1"] });
  await assert.rejects(update(settings, "admin", { actor: { id: "7" }, permissions: ["workspace.settings.view"] }), {
    code: "assistant.runtime.settings.updateForbidden"
  });
  assert.equal((await settings.getSettings({ targetSurfaceId: "admin" }, {
    context: { actor: { id: "7" }, permissions: ["workspace.settings.view"] }
  })).settings.systemPrompt, "");
  assert.equal((await update(settings, "admin", { actor: { id: "1" }, permissions: ["workspace.settings.update"] })).workspaceId, "3");

  await assert.rejects(update(settings, "ops", employee), { code: "console.ownerRequired" });
  assert.equal((await update(settings, "ops", { actor: { id: "1" }, permissions: [] })).settings.systemPrompt, "Set by 1");
});

test("a malformed settingsUpdatePermission stops the settings service from starting", () => {
  for (const settingsUpdatePermission of [false, "", { require: "all" }, { require: "none" }, ["app.admin"]]) {
    assert.throws(() => createSettings({ home: { settingsUpdatePermission } }), {
      message: /assistantServer\.home\.settingsUpdatePermission must be a permission/u
    });
  }
});
