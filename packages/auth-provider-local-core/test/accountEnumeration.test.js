import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAuthService, createLocalFileBackend, scryptPasswordStrategy } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";

// Asking for a password reset or a new confirmation link, and a failed sign-in, answer alike whether or not the email
// has an account or a waiting registration: in what they answer and in the work they do before answering, so their
// time does not say which emails have accounts either. These tests count that work rather than time it.

const PASSWORD = "correct horse battery staple";
const NOT_ANSWERED = Symbol("not answered");
// Each answer here is checked within this bound, so a request that waits for ever fails instead of hanging the run.
const BOUND = { timeout: 10_000 };

/** The file backend, and a promise for when every transaction it has started has finished. */
function watchedBackend(storeDir) {
  const backend = createLocalFileBackend({ storeDir });
  const running = new Set();
  return {
    ...backend,
    withTransaction(callback) {
      const transaction = backend.withTransaction(callback);
      running.add(transaction);
      transaction.then(() => running.delete(transaction), () => running.delete(transaction));
      return transaction;
    },
    async idle() {
      while (running.size > 0) {
        await Promise.allSettled(running);
      }
      // Then what each transaction's caller does next, such as calling a sender, has run too.
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

/**
 * A sender that keeps each message it is given and finishes sending only the first `finishing` of them: the
 * others never finish, as with a mail server that does not answer.
 * @param {{ finishing?: number }} [options]
 */
function stalledSender({ finishing = 0 } = {}) {
  const messages = [];
  const waiting = [];
  return {
    messages,
    send(message) {
      messages.push(message);
      for (const wake of waiting.splice(0)) wake();
      return messages.length <= finishing ? Promise.resolve() : new Promise(() => {});
    },
    async received(count) {
      while (messages.length < count) {
        await new Promise((resolve) => waiting.push(resolve));
      }
    }
  };
}

/** The answer of a request that has answered by the next turn of the event loop, or NOT_ANSWERED. */
function answerByNextTurn(answer) {
  return Promise.race([answer, new Promise((resolve) => setImmediate(resolve, NOT_ANSWERED))]);
}

async function startService(t, { env = {}, emailRecovery = false, emailConfirmationSender = false, ...overrides } = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-enumeration-"));
  const backend = watchedBackend(storeDir);
  t.after(async () => {
    await backend.idle();
    await fs.rm(storeDir, { recursive: true, force: true });
  });
  const options = localServiceOptions({ env, emailRecovery, emailConfirmationSender });
  return { backend, service: createLocalAuthService({ ...options, backend, ...overrides }) };
}

test("a password reset answers before its email is sent, and the same for an account and an unknown email", BOUND, async (t) => {
  const sender = stalledSender();
  const { backend, service } = await startService(t, { emailRecovery: true, recoverySender: sender.send });
  await service.register({ email: "ada@example.com", password: PASSWORD });

  const answering = service.requestPasswordReset({ email: "ada@example.com" });
  await sender.received(1);
  const forAccount = await answerByNextTurn(answering);
  assert.notEqual(forAccount, NOT_ANSWERED, "the reset waits for its email, which takes time only an account's reset takes");
  const forNobody = await service.requestPasswordReset({ email: "nobody@example.com" });
  assert.deepEqual(forNobody, forAccount);
  assert.deepEqual(forAccount, {
    ok: true,
    message: "If an account exists for that email, password reset instructions have been sent.",
    messageCode: "auth.local.recovery.requested",
    messageParams: {}
  });

  // The account's email is still sent, with its link; the unknown email gets none.
  await backend.idle();
  assert.deepEqual(sender.messages.map(({ email }) => email), ["ada@example.com"]);
  assert.match(sender.messages[0].recoveryUrl, /^http:\/\/localhost:5173\/auth\/reset-password\?token=/u);
});

test("a new confirmation link answers before its email is sent, and the same whether or not a registration waits", BOUND, async (t) => {
  // The registration's own email is sent (registering waits for it); the new link's never finishes.
  const sender = stalledSender({ finishing: 1 });
  const { backend, service } = await startService(t, {
    env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "" },
    emailConfirmationSender: true,
    confirmationSender: sender.send
  });
  const registered = await service.register({ email: "ada@example.com", password: PASSWORD });
  assert.equal(registered.requiresEmailConfirmation, true);

  const answering = service.resendRegisterConfirmation({ email: "ada@example.com" });
  await sender.received(2);
  const forRegistration = await answerByNextTurn(answering);
  assert.notEqual(forRegistration, NOT_ANSWERED, "the new link waits for its email, which takes time only a waiting registration's takes");
  const forNobody = await service.resendRegisterConfirmation({ email: "nobody@example.com" });
  assert.deepEqual(forNobody, forRegistration);
  assert.deepEqual(forRegistration, {
    ok: true,
    message: "If a registration is waiting for that email, a new confirmation link has been sent.",
    messageCode: "auth.local.register.confirmationResent",
    messageParams: {}
  });

  // The new link is still sent, and it replaced the first one; the unknown email gets none.
  await backend.idle();
  assert.deepEqual(sender.messages.map(({ email }) => email), ["ada@example.com", "ada@example.com"]);
  assert.notEqual(sender.messages[1].confirmationUrl, sender.messages[0].confirmationUrl);
});

test("a failed sign-in checks one password, whether or not its email has one to check", async (t) => {
  const checks = [];
  const passwordStrategy = {
    hashPassword: scryptPasswordStrategy.hashPassword,
    async verifyPassword(password, record) {
      checks.push(password);
      return scryptPasswordStrategy.verifyPassword(password, record);
    }
  };
  const { service } = await startService(t, { passwordStrategy });
  await service.register({ email: "ada@example.com", password: PASSWORD });

  for (const email of ["ada@example.com", "nobody@example.com", "NOBODY@example.com", "other@example.com"]) {
    checks.length = 0;
    await assert.rejects(service.login({ email, password: "a wrong password" }), { status: 401 }, email);
    assert.deepEqual(checks, ["a wrong password"], email);
  }
  // The right password still signs in, with one check.
  checks.length = 0;
  assert.equal((await service.login({ email: "ada@example.com", password: PASSWORD })).actor.email, "ada@example.com");
  assert.deepEqual(checks, [PASSWORD]);
});
