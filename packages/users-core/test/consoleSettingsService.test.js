import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/consoleSettings/consoleSettingsService.js";

function createFixture({ deny = false } = {}) {
  const calls = {
    requireConsoleOwner: [],
    updateSingleton: []
  };

  const service = createService({
    consoleService: {
      async requireConsoleOwner(context) {
        calls.requireConsoleOwner.push(context || null);
        if (deny) {
          const error = new Error("Forbidden.");
          error.status = 403;
          throw error;
        }
      }
    },
    consoleSettingsRepository: {
      async getSingleton() {
        return {
          assistantSystemPromptWorkspace: "Seed prompt"
        };
      },
      async updateSingleton(patch = {}) {
        calls.updateSingleton.push({ ...patch });
        return {
          assistantSystemPromptWorkspace: String(patch.assistantSystemPromptWorkspace || "")
        };
      }
    }
  });

  return { service, calls };
}

test("consoleSettingsService.getSettings requires owner access and returns normalized payload", async () => {
  const { service, calls } = createFixture();
  const context = {
    actor: {
      id: 7
    }
  };

  const response = await service.getSettings({ context });

  assert.deepEqual(calls.requireConsoleOwner, [context]);
  assert.deepEqual(response, {
    settings: {
      assistantSystemPromptWorkspace: "Seed prompt"
    }
  });
});

test("consoleSettingsService.updateSettings requires owner access before writing", async () => {
  const { service, calls } = createFixture();
  const context = {
    actor: {
      id: 7
    }
  };

  const response = await service.updateSettings(
    {
      assistantSystemPromptWorkspace: "Updated prompt"
    },
    { context }
  );

  assert.deepEqual(calls.requireConsoleOwner, [context]);
  assert.deepEqual(calls.updateSingleton, [
    {
      assistantSystemPromptWorkspace: "Updated prompt"
    }
  ]);
  assert.deepEqual(response, {
    settings: {
      assistantSystemPromptWorkspace: "Updated prompt"
    }
  });
});

test("consoleSettingsService denies access when owner validation fails", async () => {
  const { service } = createFixture({ deny: true });

  await assert.rejects(
    () =>
      service.getSettings({
        context: {
          actor: {
            id: 9
          }
        }
      }),
    (error) => error?.status === 403
  );
});
