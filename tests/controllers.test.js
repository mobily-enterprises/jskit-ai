import assert from "node:assert/strict";
import test from "node:test";
import { createAnnuityController } from "../controllers/annuityController.js";
import { createAuthController } from "../controllers/authController.js";
import { createHistoryController } from "../controllers/historyController.js";

function createReplyDouble() {
  return {
    statusCode: null,
    payload: null,
    cookies: [],
    csrfToken: "csrf-token",
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
    async generateCsrf() {
      return this.csrfToken;
    }
  };
}

test("annuity controller validates, calculates, appends history, and returns combined payload", async () => {
  const receivedPayloads = [];
  const annuityController = createAnnuityController({
    annuityService: {
      validateAndNormalizeInput(payload) {
        receivedPayloads.push(payload);
        return { normalized: true };
      },
      calculateAnnuity() {
        return {
          value: "123.000000000000",
          mode: "pv"
        };
      }
    },
    annuityHistoryService: {
      async appendCalculation(userId, result) {
        assert.equal(userId, 7);
        assert.equal(result.value, "123.000000000000");
        return { id: "history-1" };
      }
    }
  });

  const reply = createReplyDouble();
  await annuityController.calculate(
    {
      user: { id: 7 },
      body: { payment: 500 }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    value: "123.000000000000",
    mode: "pv",
    historyId: "history-1"
  });
  assert.equal(receivedPayloads[0].payment, 500);

  const fallbackReply = createReplyDouble();
  await annuityController.calculate(
    {
      user: { id: 7 }
    },
    fallbackReply
  );
  assert.equal(fallbackReply.statusCode, 200);
  assert.deepEqual(receivedPayloads[1], {});
});

test("history controller maps pagination query and returns service response", async () => {
  const calls = [];
  const historyController = createHistoryController({
    annuityHistoryService: {
      async listForUser(user, pagination) {
        calls.push({ user, pagination });
        return {
          entries: [],
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: 0,
          totalPages: 1
        };
      }
    }
  });

  const reply = createReplyDouble();
  await historyController.list(
    {
      user: { id: 11, displayName: "alex" },
      query: { page: "2", pageSize: "25" }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.page, 2);

  const defaultReply = createReplyDouble();
  await historyController.list(
    {
      user: { id: 11, displayName: "alex" }
    },
    defaultReply
  );
  assert.equal(defaultReply.statusCode, 200);
  assert.equal(defaultReply.payload.page, 1);

  assert.deepEqual(calls, [
    {
      user: { id: 11, displayName: "alex" },
      pagination: { page: 2, pageSize: 25 }
    },
    {
      user: { id: 11, displayName: "alex" },
      pagination: { page: 1, pageSize: 10 }
    }
  ]);
});

test("auth controller covers register/login/logout/session/password flows", async () => {
  const calls = [];
  const authService = {
    async register(payload) {
      calls.push(["register", payload]);
      if (payload.email === "confirm@example.com") {
        return {
          requiresEmailConfirmation: true,
          email: payload.email,
          profile: { displayName: "confirm-user" },
          session: null
        };
      }

      return {
        requiresEmailConfirmation: false,
        profile: { displayName: "new-user" },
        session: { access_token: "a", refresh_token: "b", expires_in: 3600 }
      };
    },
    async login(payload) {
      calls.push(["login", payload]);
      return {
        profile: { displayName: "logged-user" },
        session: { access_token: "la", refresh_token: "lb", expires_in: 3600 }
      };
    },
    async authenticateRequest(request) {
      calls.push(["authenticateRequest", request.tokenState]);
      if (request.tokenState === "transient") {
        return { authenticated: false, clearSession: false, session: null, transientFailure: true };
      }
      if (request.tokenState === "none") {
        return { authenticated: false, clearSession: true, session: null, transientFailure: false };
      }
      return {
        authenticated: true,
        profile: { displayName: "session-user" },
        clearSession: false,
        session: { access_token: "sa", refresh_token: "sb", expires_in: 3600 },
        transientFailure: false
      };
    },
    async requestPasswordReset(payload) {
      calls.push(["requestPasswordReset", payload]);
      return { ok: true, message: "sent" };
    },
    async completePasswordRecovery(payload) {
      calls.push(["completePasswordRecovery", payload]);
      return {
        profile: { displayName: "recovered-user" },
        session: { access_token: "ra", refresh_token: "rb", expires_in: 3600 }
      };
    },
    async resetPassword(request, payload) {
      calls.push(["resetPassword", request.marker, payload]);
    },
    writeSessionCookies(reply, session) {
      reply.cookies.push(["write", session.access_token]);
    },
    clearSessionCookies(reply) {
      reply.cookies.push(["clear"]);
    }
  };

  const controller = createAuthController({ authService });

  const registerConfirmReply = createReplyDouble();
  await controller.register({ body: { email: "confirm@example.com", password: "Password123" } }, registerConfirmReply);
  assert.equal(registerConfirmReply.statusCode, 201);
  assert.equal(registerConfirmReply.payload.requiresEmailConfirmation, true);

  const registerReply = createReplyDouble();
  await controller.register({ body: { email: "ok@example.com", password: "Password123" } }, registerReply);
  assert.equal(registerReply.statusCode, 201);
  assert.equal(registerReply.payload.username, "new-user");
  assert.equal(registerReply.cookies[0][0], "write");

  const loginReply = createReplyDouble();
  await controller.login({ body: { email: "ok@example.com", password: "Password123" } }, loginReply);
  assert.equal(loginReply.statusCode, 200);
  assert.equal(loginReply.payload.username, "logged-user");

  const sessionTransientReply = createReplyDouble();
  await controller.session({ tokenState: "transient" }, sessionTransientReply);
  assert.equal(sessionTransientReply.statusCode, 503);
  assert.equal(sessionTransientReply.payload.csrfToken, "csrf-token");

  const sessionSignedOutReply = createReplyDouble();
  await controller.session({ tokenState: "none" }, sessionSignedOutReply);
  assert.equal(sessionSignedOutReply.statusCode, 200);
  assert.equal(sessionSignedOutReply.payload.authenticated, false);
  assert.equal(sessionSignedOutReply.cookies[0][0], "clear");

  const sessionSignedInReply = createReplyDouble();
  await controller.session({ tokenState: "ok" }, sessionSignedInReply);
  assert.equal(sessionSignedInReply.statusCode, 200);
  assert.equal(sessionSignedInReply.payload.authenticated, true);
  assert.equal(sessionSignedInReply.cookies[0][0], "write");

  const forgotReply = createReplyDouble();
  await controller.requestPasswordReset({ body: { email: "ok@example.com" } }, forgotReply);
  assert.equal(forgotReply.statusCode, 200);
  assert.equal(forgotReply.payload.ok, true);

  const recoveryReply = createReplyDouble();
  await controller.completePasswordRecovery({ body: { code: "abc" } }, recoveryReply);
  assert.equal(recoveryReply.statusCode, 200);
  assert.deepEqual(recoveryReply.payload, { ok: true });
  assert.equal(recoveryReply.cookies[0][0], "write");

  const resetReply = createReplyDouble();
  await controller.resetPassword({ marker: "req1", body: { password: "NewPassword123" } }, resetReply);
  assert.equal(resetReply.statusCode, 200);
  assert.equal(resetReply.payload.ok, true);
  assert.equal(resetReply.cookies[0][0], "clear");

  const logoutReply = createReplyDouble();
  await controller.logout({}, logoutReply);
  assert.equal(logoutReply.statusCode, 200);
  assert.deepEqual(logoutReply.payload, { ok: true });
  assert.equal(logoutReply.cookies[0][0], "clear");

  const fallbackPayloadReply = createReplyDouble();
  await controller.register({}, fallbackPayloadReply);
  assert.equal(fallbackPayloadReply.statusCode, 201);

  const fallbackLoginReply = createReplyDouble();
  await controller.login({}, fallbackLoginReply);
  assert.equal(fallbackLoginReply.statusCode, 200);

  const fallbackForgotReply = createReplyDouble();
  await controller.requestPasswordReset({}, fallbackForgotReply);
  assert.equal(fallbackForgotReply.statusCode, 200);

  const fallbackRecoveryReply = createReplyDouble();
  await controller.completePasswordRecovery({}, fallbackRecoveryReply);
  assert.equal(fallbackRecoveryReply.statusCode, 200);

  const fallbackResetReply = createReplyDouble();
  await controller.resetPassword({ marker: "req2" }, fallbackResetReply);
  assert.equal(fallbackResetReply.statusCode, 200);

  assert.ok(calls.length > 0);
});
