import assert from "node:assert/strict";
import test from "node:test";

import { createController as createSettingsController } from "../server/modules/settings/controller.js";
import { createReplyDouble } from "./helpers/replyDouble.js";

function createBaseRequest(overrides = {}) {
  return {
    id: "req-settings-1",
    method: "PATCH",
    url: "/api/v1/settings/security/methods/password",
    headers: {
      "x-forwarded-for": "203.0.113.21",
      "user-agent": "settings-action-test"
    },
    user: {
      id: 44,
      email: "user@example.com"
    },
    ...overrides
  };
}

test("settings controller delegates security writes to canonical actions", async () => {
  const calls = [];
  const controller = createSettingsController({
    authService: {
      writeSessionCookies() {}
    },
    actionExecutor: {
      async execute({ actionId, input, context }) {
        calls.push({
          actionId,
          input,
          context
        });
        return { ok: true };
      }
    }
  });

  const passwordReply = createReplyDouble();
  await controller.setPasswordMethodEnabled(
    createBaseRequest({
      method: "PATCH",
      url: "/api/v1/settings/security/methods/password",
      body: { enabled: true }
    }),
    passwordReply
  );
  assert.equal(passwordReply.statusCode, 200);

  const unlinkReply = createReplyDouble();
  await controller.unlinkOAuthProvider(
    createBaseRequest({
      method: "DELETE",
      url: "/api/v1/settings/security/oauth/google",
      params: { provider: "google" }
    }),
    unlinkReply
  );
  assert.equal(unlinkReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    ["settings.security.password_method.toggle", "settings.security.oauth.unlink"]
  );
  assert.equal(calls[0].context.channel, "api");
  assert.deepEqual(calls[0].input, { enabled: true });
  assert.deepEqual(calls[1].input, { provider: "google" });
});

test("settings controller rethrows action failures", async () => {
  const expectedError = Object.assign(new Error("validation"), {
    status: 400,
    code: "VALIDATION_ERROR"
  });
  const controller = createSettingsController({
    authService: {
      writeSessionCookies() {}
    },
    actionExecutor: {
      async execute({ actionId }) {
        assert.equal(actionId, "settings.security.password_method.toggle");
        throw expectedError;
      }
    }
  });

  const reply = createReplyDouble();
  await assert.rejects(
    () =>
      controller.setPasswordMethodEnabled(
        createBaseRequest({
          body: { enabled: false }
        }),
        reply
      ),
    (error) => {
      assert.equal(error, expectedError);
      return true;
    }
  );
});
