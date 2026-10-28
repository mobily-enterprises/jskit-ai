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

test("consoleService errors carry console codes rendering their English", async () => {
  const { catalogMessage, formatMessage, messageKeyForCode } = await import("@jskit-ai/kernel/shared/i18n");
  const english = (await import("../locales/en.json", { with: { type: "json" } })).default;
  const { service } = createFixture("1");
  const failures = [
    [() => service.ensureInitialConsoleMember("not-an-id"), 400, "console.owner.invalidUser"],
    [() => service.requireConsoleOwner({}), 401, "console.owner.authenticationRequired"],
    [() => service.requireConsoleOwner({ actor: { id: "2" } }), 403, "console.owner.forbidden"]
  ];
  for (const [run, status, code] of failures) {
    await assert.rejects(run, (error) => {
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.deepEqual(error.params, {});
      assert.equal(formatMessage(catalogMessage(english, messageKeyForCode(code)), error.params), error.message);
      return true;
    });
  }
});
