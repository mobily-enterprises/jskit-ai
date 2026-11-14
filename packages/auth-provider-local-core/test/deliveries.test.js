import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAuthService, createLocalDeliveries, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";

const PASSWORD = "correct horse battery staple";

// A logger that keeps what it is given, by level.
function recordingLogger() {
  const logs = { info: [], warn: [], error: [] };
  return {
    logs,
    logger: {
      info: (details, message) => logs.info.push({ details, message }),
      warn: (details, message) => logs.warn.push({ details, message }),
      error: (details, message) => logs.error.push({ details, message }),
      debug() {}
    }
  };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function startService(t, { env = {}, emailRecovery = false, emailConfirmationSender = false, logger, ...overrides }) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-deliveries-"));
  const deliveries = createLocalDeliveries({ logger });
  t.after(async () => {
    await deliveries.settled();
    await fs.rm(storeDir, { recursive: true, force: true });
  });
  const service = createLocalAuthService({
    ...localServiceOptions({ env, emailRecovery, emailConfirmationSender }),
    backend: createLocalFileBackend({ storeDir }),
    deliveries,
    logger,
    ...overrides
  });
  return { deliveries, service };
}

test("a failed password reset email is logged with its address, never its link, and answered as any reset is", async (t) => {
  const { logs, logger } = recordingLogger();
  const failure = new Error("delivery unavailable");
  const links = [];
  const { deliveries, service } = await startService(t, {
    emailRecovery: true,
    logger,
    recoverySender: async ({ recoveryUrl }) => {
      links.push(recoveryUrl);
      throw failure;
    }
  });
  await service.register({ email: "ada@example.com", password: PASSWORD });

  const answer = await service.requestPasswordReset({ email: "ada@example.com" });
  assert.deepEqual(answer, await service.requestPasswordReset({ email: "nobody@example.com" }));
  assert.equal(await deliveries.settled(), true);
  assert.equal(links.length, 1);
  assert.deepEqual(logs.error, [{ details: { err: failure, email: "ada@example.com" }, message: "Sending the password reset email failed." }]);
  assert.equal(JSON.stringify(logs).includes(new URL(links[0]).searchParams.get("token")), false);
});

test("a failed new confirmation link email is logged with its address, never its link, and answered as any is", async (t) => {
  const { logs, logger } = recordingLogger();
  const failure = new Error("delivery unavailable");
  const links = [];
  let failing = false;
  const { deliveries, service } = await startService(t, {
    env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "" },
    emailConfirmationSender: true,
    logger,
    confirmationSender: async ({ confirmationUrl }) => {
      links.push(confirmationUrl);
      if (failing) throw failure;
    }
  });
  await service.register({ email: "ada@example.com", password: PASSWORD });
  failing = true;

  const answer = await service.resendRegisterConfirmation({ email: "ada@example.com" });
  assert.deepEqual(answer, await service.resendRegisterConfirmation({ email: "nobody@example.com" }));
  assert.equal(await deliveries.settled(), true);
  assert.equal(links.length, 2);
  assert.deepEqual(logs.error, [{ details: { err: failure, email: "ada@example.com" }, message: "Sending the email confirmation email failed." }]);
  for (const link of links) {
    assert.equal(JSON.stringify(logs).includes(new URL(link).searchParams.get("confirmation_token")), false);
  }
});

test("settled() waits for every email being sent, those they start included", async () => {
  const { logs, logger } = recordingLogger();
  const deliveries = createLocalDeliveries({ logger });
  const { promise: gate, resolve: open } = Promise.withResolvers();
  const done = [];
  deliveries.send("the first email", "first@example.com", async () => {
    await gate;
    done.push("first");
    deliveries.send("the second email", "second@example.com", async () => {
      done.push("second");
    });
  });
  deliveries.send("a failing email", "failing@example.com", () => {
    throw new Error("refused at once");
  });

  let settled = null;
  const settling = deliveries.settled().then((value) => {
    settled = value;
  });
  await nextTurn();
  assert.equal(settled, null, "settled() waits while an email is being sent");
  open();
  await settling;
  assert.equal(settled, true);
  assert.deepEqual(done, ["first", "second"]);
  assert.deepEqual(logs.error.map(({ details, message }) => [details.email, details.err.message, message]), [
    ["failing@example.com", "refused at once", "Sending a failing email failed."]
  ]);
  assert.equal(await deliveries.settled(), true, "nothing left to wait for");
});

test("settled({ timeoutMs }) stops waiting for an email that never finishes, and logs how many were left", async () => {
  const { logs, logger } = recordingLogger();
  const deliveries = createLocalDeliveries({ logger });
  deliveries.send("a stalled email", "stalled@example.com", () => new Promise(() => {}));
  assert.equal(await deliveries.settled({ timeoutMs: 5 }), false);
  assert.deepEqual(logs.warn, [{
    details: { unfinishedEmails: 1 },
    message: "Local auth stopped waiting for the emails it was still sending; they may not arrive."
  }]);
});
