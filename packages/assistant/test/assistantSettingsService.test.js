import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/services/assistantSettingsService.js";

function createFixture() {
  const calls = {
    requireConsoleOwner: 0,
    ensureConsoleSettings: 0,
    updateConsoleSettings: [],
    ensureWorkspaceSettings: [],
    updateWorkspaceSettings: []
  };

  const service = createService({
    consoleService: {
      async requireConsoleOwner() {
        calls.requireConsoleOwner += 1;
      }
    },
    assistantSettingsRepository: {
      async ensureConsoleSettings() {
        calls.ensureConsoleSettings += 1;
        return {
          workspaceSurfacePrompt: "Workspace prompt"
        };
      },
      async updateConsoleSettings(patch = {}) {
        calls.updateConsoleSettings.push({
          ...patch
        });
        return {
          workspaceSurfacePrompt: String(patch.workspaceSurfacePrompt || "")
        };
      },
      async ensureWorkspaceSettings(workspaceId) {
        calls.ensureWorkspaceSettings.push(workspaceId);
        return {
          workspaceId: 7,
          appSurfacePrompt: "App prompt"
        };
      },
      async updateWorkspaceSettings(workspaceId, patch = {}) {
        calls.updateWorkspaceSettings.push({
          workspaceId,
          patch: {
            ...patch
          }
        });
        return {
          workspaceId: 7,
          appSurfacePrompt: String(patch.appSurfacePrompt || "")
        };
      }
    }
  });

  return {
    service,
    calls
  };
}

test("assistantSettingsService enforces console owner on console settings reads", async () => {
  const { service, calls } = createFixture();

  const result = await service.getConsoleSettings({
    context: {
      actor: {
        id: 9
      }
    }
  });

  assert.equal(calls.requireConsoleOwner, 1);
  assert.equal(calls.ensureConsoleSettings, 1);
  assert.deepEqual(result, {
    settings: {
      workspaceSurfacePrompt: "Workspace prompt"
    }
  });
});

test("assistantSettingsService resolves prompts by surface", async () => {
  const { service, calls } = createFixture();
  const workspace = {
    id: 7
  };

  const appPrompt = await service.resolveSystemPrompt(workspace, {
    surface: "app"
  });
  const adminPrompt = await service.resolveSystemPrompt(workspace, {
    surface: "admin"
  });

  assert.equal(appPrompt, "App prompt");
  assert.equal(adminPrompt, "Workspace prompt");
  assert.deepEqual(calls.ensureWorkspaceSettings, [7]);
  assert.equal(calls.ensureConsoleSettings, 1);
});

test("assistantSettingsService patch updates are no-ops when prompt keys are omitted", async () => {
  const { service, calls } = createFixture();
  const workspace = {
    id: 7
  };

  const consoleResult = await service.updateConsoleSettings(
    {},
    {
      context: {
        actor: {
          id: 9
        }
      }
    }
  );
  const workspaceResult = await service.updateWorkspaceSettings(workspace, {});

  assert.equal(calls.requireConsoleOwner, 1);
  assert.deepEqual(calls.updateConsoleSettings, []);
  assert.deepEqual(calls.updateWorkspaceSettings, []);
  assert.deepEqual(consoleResult, {
    settings: {
      workspaceSurfacePrompt: "Workspace prompt"
    }
  });
  assert.deepEqual(workspaceResult, {
    settings: {
      appSurfacePrompt: "App prompt"
    }
  });
});
