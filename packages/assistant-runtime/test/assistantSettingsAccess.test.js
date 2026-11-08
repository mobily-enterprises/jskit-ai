import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { createService } from "../src/server/services/assistantConfigService.js";
import { createAssistantSettingsActions } from "../src/server/createAssistantSettingsActions.js";
import { actionIds } from "../src/server/actionIds.js";

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
          // As console-core's consoleService refuses: a 403.
          throw new AppError(403, "Console owner required.", { code: "console.ownerRequired" });
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

test("the settings say whether the reader may change them, by the check that refuses the change", async () => {
  const can = (settings, targetSurfaceId, context) => settings.canUpdateSettings({ targetSurfaceId }, { context });
  const admin = { actor: { id: "1" }, permissions: ["assistant.settings.update"] };
  const settings = createSettings({}, { consoleOwnerIds: ["1"] });
  assert.equal(await can(settings, "home", employee), false);
  assert.equal(await can(settings, "home", admin), true);
  assert.equal(await can(settings, "admin", { actor: { id: "7" }, permissions: ["workspace.settings.view"] }), false);
  assert.equal(await can(settings, "admin", { actor: { id: "1" }, permissions: ["workspace.settings.update"] }), true);
  assert.equal(await can(settings, "ops", employee), false);
  assert.equal(await can(settings, "ops", { actor: { id: "1" }, permissions: [] }), true);

  // An app's settingsUpdatePermission decides, as it does for the change itself.
  const configured = createSettings({ home: { settingsUpdatePermission: "app.admin" } });
  assert.equal(await can(configured, "home", admin), false);
  assert.equal(await can(configured, "home", { actor: { id: "1" }, permissions: ["app.admin"] }), true);
  assert.equal(await can(createSettings({ home: { settingsUpdatePermission: { require: "authenticated" } } }), "home", employee), true);

  // A failure that is not a refusal still fails.
  const noConsole = createService({
    assistantConfigRepository: createSettingsRows(),
    consoleService: null,
    appConfig: createAppConfig({}),
    workspaceScopeSupport: null
  });
  await assert.rejects(can(noConsole, "ops", admin), /requires consoleService\.requireConsoleOwner\(\)/u);

  // The settings read carries the answer, and a successful change says the person may change them.
  const definitions = createAssistantSettingsActions({ assistantConfigService: configured, settingsSurfaces: ["home"] });
  const execute = (id, input, context) => definitions.find((definition) => definition.id === id).execute(input, context);
  const read = async (context) => (await execute(actionIds.settingsRead, { targetSurfaceId: "home" }, context)).value;
  assert.deepEqual(await read(admin), {
    targetSurfaceId: "home", workspaceId: null, scopeKey: "home:", settings: { systemPrompt: "" }, canUpdate: false
  });
  const appAdmin = { actor: { id: "1" }, permissions: ["app.admin"] };
  assert.equal((await read(appAdmin)).canUpdate, true);
  const changed = await execute(actionIds.settingsUpdate, { targetSurfaceId: "home", patch: { systemPrompt: "Be brief." } }, appAdmin);
  assert.deepEqual(changed.value, {
    targetSurfaceId: "home", workspaceId: null, scopeKey: "home:", settings: { systemPrompt: "Be brief." }, canUpdate: true
  });
});

test("a malformed settingsUpdatePermission stops the settings service from starting", () => {
  for (const settingsUpdatePermission of [false, "", { require: "all" }, { require: "none" }, ["app.admin"]]) {
    assert.throws(() => createSettings({ home: { settingsUpdatePermission } }), {
      message: /assistantServer\.home\.settingsUpdatePermission must be a permission/u
    });
  }
});
