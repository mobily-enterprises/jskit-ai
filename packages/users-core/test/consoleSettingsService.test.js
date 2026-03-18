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
        return {};
      },
      async updateSingleton(patch = {}) {
        calls.updateSingleton.push({ ...patch });
        return {};
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
    settings: {}
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
    {},
    { context }
  );

  assert.deepEqual(calls.requireConsoleOwner, [context]);
  assert.deepEqual(calls.updateSingleton, [{}]);
  assert.deepEqual(response, {
    settings: {}
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
