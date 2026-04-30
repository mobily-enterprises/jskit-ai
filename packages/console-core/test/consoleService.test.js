import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/consoleSettings/consoleService.js";

function createFixture(initialOwnerUserId = null) {
  const state = {
    ownerUserId: initialOwnerUserId
  };

  const service = createService({
    consoleSettingsRepository: {
      async getSingleton() {
        return {
          ownerUserId: state.ownerUserId
        };
      },
      async ensureOwnerUserId(userId) {
        const normalizedUserId = String(userId || "");
        if (!state.ownerUserId) {
          state.ownerUserId = normalizedUserId;
        }
        return state.ownerUserId;
      }
    }
  });

  return { service, state };
}

test("consoleService seeds the first authenticated user as console owner", async () => {
  const { service, state } = createFixture();

  const firstOwner = await service.ensureInitialConsoleMember("7");
  const secondAttempt = await service.ensureInitialConsoleMember("9");

  assert.equal(firstOwner, "7");
  assert.equal(secondAttempt, "7");
  assert.equal(state.ownerUserId, "7");
});

test("consoleService.isConsoleOwnerUserId reports current ownership without reseeding", async () => {
  const { service } = createFixture("7");

  assert.equal(await service.isConsoleOwnerUserId("7"), true);
  assert.equal(await service.isConsoleOwnerUserId("9"), false);
});

test("consoleService.requireConsoleOwner denies authenticated non-owners", async () => {
  const { service } = createFixture("7");

  await assert.rejects(
    () =>
      service.requireConsoleOwner({
        actor: {
          id: "9"
        }
      }),
    (error) => error?.status === 403
  );
});

test("consoleService.requireConsoleOwner requires authentication", async () => {
  const { service } = createFixture("7");

  await assert.rejects(
    () => service.requireConsoleOwner({}),
    (error) => error?.status === 401
  );
});
