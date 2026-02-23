import assert from "node:assert/strict";
import test from "node:test";

import { createController as createSettingsController } from "../server/modules/settings/controller.js";

function createReplyDouble() {
  return {
    statusCode: null,
    payload: null,
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function createBaseRequest(overrides = {}) {
  return {
    id: "req-settings-1",
    method: "PATCH",
    url: "/api/settings/security/methods/password",
    headers: {
      "x-forwarded-for": "203.0.113.21",
      "user-agent": "settings-audit-test"
    },
    user: {
      id: 44,
      email: "user@example.com"
    },
    ...overrides
  };
}

test("settings controller emits success security audit events", async () => {
  const auditEvents = [];
  const controller = createSettingsController({
    userSettingsService: {
      async setPasswordMethodEnabled() {
        return { ok: true };
      },
      async unlinkOAuthProvider() {
        return { ok: true };
      }
    },
    authService: {
      writeSessionCookies() {}
    },
    auditService: {
      async recordSafe(event) {
        auditEvents.push(event);
      }
    }
  });

  const passwordReply = createReplyDouble();
  await controller.setPasswordMethodEnabled(
    createBaseRequest({
      method: "PATCH",
      url: "/api/settings/security/methods/password",
      body: { enabled: true }
    }),
    passwordReply
  );
  assert.equal(passwordReply.statusCode, 200);

  const unlinkReply = createReplyDouble();
  await controller.unlinkOAuthProvider(
    createBaseRequest({
      method: "DELETE",
      url: "/api/settings/security/oauth/google",
      params: { provider: "google" }
    }),
    unlinkReply
  );
  assert.equal(unlinkReply.statusCode, 200);

  assert.deepEqual(
    auditEvents.map((event) => [event.action, event.outcome]),
    [
      ["auth.password_method.toggled", "success"],
      ["auth.oauth_provider.unlinked", "success"]
    ]
  );
  assert.equal(auditEvents[0].targetUserId, 44);
  assert.equal(auditEvents[0].metadata.enabled, true);
  assert.equal(auditEvents[1].metadata.provider, "google");
});

test("settings controller emits failure audit event and rethrows", async () => {
  const auditEvents = [];
  const expectedError = Object.assign(new Error("validation"), {
    status: 400,
    code: "VALIDATION_ERROR"
  });
  const controller = createSettingsController({
    userSettingsService: {
      async setPasswordMethodEnabled() {
        throw expectedError;
      }
    },
    authService: {
      writeSessionCookies() {}
    },
    auditService: {
      async recordSafe(event) {
        auditEvents.push(event);
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

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "auth.password_method.toggled");
  assert.equal(auditEvents[0].outcome, "failure");
  assert.equal(auditEvents[0].metadata.error.status, 400);
  assert.equal(auditEvents[0].metadata.error.code, "VALIDATION_ERROR");
});
