import assert from "node:assert/strict";
import test from "node:test";
import { registerCommonRepositories } from "../src/server/common/registerCommonRepositories.js";

test("registerCommonRepositories exposes the shared users-core repositories", async () => {
  const bindings = new Map();
  const app = {
    singleton(token, factory) {
      bindings.set(token, factory);
      return this;
    }
  };

  registerCommonRepositories(app);

  assert.equal(typeof bindings.get("internal.repository.user-settings"), "function");
  assert.equal(typeof bindings.get("internal.repository.user-profiles"), "function");

  const scope = {
    make(token) {
      assert.equal(token, "jskit.database.knex");
      return Object.assign(() => {
        throw new Error("query execution not expected");
      }, {
        async transaction(work) {
          return work({ trxId: "trx-1" });
        }
      });
    }
  };

  const settingsRepository = bindings.get("internal.repository.user-settings")(scope);
  const profileRepository = bindings.get("internal.repository.user-profiles")(scope);

  assert.equal(typeof settingsRepository.findByUserId, "function");
  assert.equal(typeof profileRepository.findById, "function");
});
