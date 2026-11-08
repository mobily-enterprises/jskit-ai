import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SETUP_CODE_FILE,
  createFirstAccountSetup,
  createLocalAuthService,
  createLocalFileBackend
} from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";

const PASSWORD = "correct horse battery staple";
const SETUP_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/u;
const codeRequired = { status: 403, code: "auth.local.setup.codeRequired" };
const codeInvalid = { status: 403, code: "auth.local.setup.codeInvalid" };

async function temporaryStoreDir(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-setup-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return storeDir;
}

/**
 * A local auth server over the file store in `storeDir`, started as its
 * provider starts it: production unless `env` says otherwise.
 */
async function startServer(storeDir, { env = {}, confirmationSender } = {}) {
  const warnings = [];
  const logger = { info() {}, warn: (fields, message) => warnings.push({ fields, message }), error() {}, debug() {} };
  const options = localServiceOptions({
    env: {
      NODE_ENV: "production",
      AUTH_LOCAL_STORE_DIR: storeDir,
      AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "",
      APP_PUBLIC_URL: "https://app.example.test",
      ...env
    },
    emailConfirmationSender: confirmationSender !== undefined
  });
  const backend = createLocalFileBackend({ storeDir });
  const firstAccountSetup = createFirstAccountSetup({ backend, config: options.config, logger });
  await firstAccountSetup.start();
  const service = createLocalAuthService({
    ...options,
    backend,
    logger,
    firstAccountSetup,
    ...(confirmationSender && { confirmationSender })
  });
  const logged = warnings.filter((warning) => warning.fields.firstAccountSetupCode);
  return { service, warnings, setupCode: logged.at(-1)?.fields.firstAccountSetupCode || "" };
}

function waitingForFirstAccount(service) {
  return service.getCapabilities().features.firstAccountSetupCode;
}

async function codeFile(storeDir) {
  const file = path.join(storeDir, SETUP_CODE_FILE);
  try {
    return { text: await fs.readFile(file, "utf8"), mode: (await fs.stat(file)).mode & 0o777 };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

test("a production server without accounts asks its first registration for the setup code it logs, then never again", async (t) => {
  const storeDir = await temporaryStoreDir(t);
  const { service, warnings, setupCode } = await startServer(storeDir);
  assert.match(setupCode, SETUP_CODE_PATTERN);
  assert.deepEqual(warnings, [{
    fields: { firstAccountSetupCode: setupCode, firstAccountSetupCodeFile: path.join(storeDir, SETUP_CODE_FILE) },
    message: "Local auth has no account yet: register the first account with this setup code."
  }]);
  assert.deepEqual(await codeFile(storeDir), { text: `${setupCode}\n`, mode: 0o600 });
  assert.equal(waitingForFirstAccount(service), true);

  await assert.rejects(service.register({ email: "owner@example.com", password: PASSWORD }), codeRequired);
  await assert.rejects(
    service.register({ email: "owner@example.com", password: PASSWORD, setupCode: "AAAAA-AAAAA-AAAAA-AAAAA" }),
    codeInvalid
  );
  // Letter case, spaces and dashes do not matter.
  const typed = setupCode.toLowerCase().replaceAll("-", " ");
  const owner = await service.register({ email: "owner@example.com", password: PASSWORD, setupCode: typed });
  assert.ok(owner.session.access_token);

  // The first account exists: the code stops working and its file is gone.
  assert.equal(waitingForFirstAccount(service), false);
  assert.equal(await codeFile(storeDir), null);
  const second = await service.register({ email: "second@example.com", password: PASSWORD });
  assert.ok(second.session.access_token);
});

test("restarting while there is no account makes a new code, and the old one stops working", async (t) => {
  const storeDir = await temporaryStoreDir(t);
  const first = await startServer(storeDir);
  const restarted = await startServer(storeDir);
  assert.match(restarted.setupCode, SETUP_CODE_PATTERN);
  assert.notEqual(restarted.setupCode, first.setupCode);
  assert.equal((await codeFile(storeDir)).text, `${restarted.setupCode}\n`);
  await assert.rejects(
    restarted.service.register({ email: "owner@example.com", password: PASSWORD, setupCode: first.setupCode }),
    codeInvalid
  );
  await restarted.service.register({ email: "owner@example.com", password: PASSWORD, setupCode: restarted.setupCode });

  // Once an account exists, a restart makes no code and removes a leftover file.
  await fs.writeFile(path.join(storeDir, SETUP_CODE_FILE), "LEFTOVER\n");
  const later = await startServer(storeDir);
  assert.equal(later.setupCode, "");
  assert.deepEqual(later.warnings, []);
  assert.equal(await codeFile(storeDir), null);
  assert.equal(waitingForFirstAccount(later.service), false);
});

test("with email confirmation, the code admits the first registration, and confirming it ends the setup", async (t) => {
  const storeDir = await temporaryStoreDir(t);
  const links = [];
  const { service, setupCode } = await startServer(storeDir, {
    env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "" },
    confirmationSender: async ({ confirmationUrl }) => { links.push(new URL(confirmationUrl)); }
  });
  const waiting = await service.register({ email: "owner@example.com", password: PASSWORD, setupCode });
  assert.equal(waiting.requiresEmailConfirmation, true);
  // Until that registration is confirmed there is still no account, so the code is still needed.
  assert.equal(waitingForFirstAccount(service), true);
  await assert.rejects(service.register({ email: "early@example.com", password: PASSWORD }), codeRequired);

  const owner = await service.confirmRegistration({ token: links[0].searchParams.get("confirmation_token"), password: PASSWORD });
  assert.equal(owner.actor.email, "owner@example.com");
  assert.ok(owner.session.access_token);
  assert.equal(waitingForFirstAccount(service), false);
  assert.equal(await codeFile(storeDir), null);
  assert.equal((await service.register({ email: "later@example.com", password: PASSWORD })).requiresEmailConfirmation, true);
});

test("development asks for no setup code", async (t) => {
  const storeDir = await temporaryStoreDir(t);
  const { service, warnings } = await startServer(storeDir, { env: { NODE_ENV: "development" } });
  assert.deepEqual(warnings, []);
  assert.equal(await codeFile(storeDir), null);
  assert.equal(waitingForFirstAccount(service), false);
  assert.ok((await service.register({ email: "dev@example.com", password: PASSWORD })).session.access_token);
});

test("a service composed without a started setup checks for an account on its first registration", async (t) => {
  const storeDir = await temporaryStoreDir(t);
  const options = localServiceOptions({
    env: { NODE_ENV: "production", AUTH_LOCAL_STORE_DIR: storeDir, AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "" }
  });
  const service = createLocalAuthService({ ...options, backend: createLocalFileBackend({ storeDir }) });
  await assert.rejects(service.register({ email: "owner@example.com", password: PASSWORD }), codeRequired);
  const setupCode = (await codeFile(storeDir)).text.trim();
  assert.match(setupCode, SETUP_CODE_PATTERN);
  await service.register({ email: "owner@example.com", password: PASSWORD, setupCode });
});

test("a setup code supplied in AUTH_LOCAL_SETUP_CODE is asked for at every start, and is never logged or written", async (t) => {
  const storeDir = await temporaryStoreDir(t);
  const supplied = "Gq7v-K2pX_9mLr4TzWb8NcYd3HsJ5eFa";
  await fs.writeFile(path.join(storeDir, SETUP_CODE_FILE), "LEFTOVER\n");
  const first = await startServer(storeDir, { env: { AUTH_LOCAL_SETUP_CODE: supplied } });
  assert.deepEqual(first.warnings, [{
    fields: { firstAccountSetupCodeEnv: "AUTH_LOCAL_SETUP_CODE" },
    message: "Local auth has no account yet: register the first account with the setup code in AUTH_LOCAL_SETUP_CODE."
  }]);
  assert.equal(JSON.stringify(first.warnings).includes(supplied), false);
  assert.equal(await codeFile(storeDir), null);
  assert.equal(waitingForFirstAccount(first.service), true);

  // A restart, or a second server, asks for the same code.
  const restarted = await startServer(storeDir, { env: { AUTH_LOCAL_SETUP_CODE: supplied } });
  await assert.rejects(restarted.service.register({ email: "owner@example.com", password: PASSWORD }), codeRequired);
  await assert.rejects(
    restarted.service.register({ email: "owner@example.com", password: PASSWORD, setupCode: "AAAAA-AAAAA-AAAAA-AAAAA" }),
    codeInvalid
  );
  const owner = await restarted.service.register({
    email: "owner@example.com",
    password: PASSWORD,
    setupCode: supplied.toLowerCase()
  });
  assert.ok(owner.session.access_token);
  assert.equal(waitingForFirstAccount(restarted.service), false);

  // Once an account exists, the supplied code is not asked for and nothing is logged.
  const later = await startServer(storeDir, { env: { AUTH_LOCAL_SETUP_CODE: supplied } });
  assert.deepEqual(later.warnings, []);
  assert.ok((await later.service.register({ email: "second@example.com", password: PASSWORD })).session.access_token);
});

test("a supplied setup code needs 20 letters and digits in production, and development ignores it", () => {
  assert.throws(
    () => localServiceOptions({ env: { NODE_ENV: "production", AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "", AUTH_LOCAL_SETUP_CODE: "short-code-1234" } }),
    /AUTH_LOCAL_SETUP_CODE must have at least 20 letters and digits\./u
  );
  assert.equal(localServiceOptions({ env: { NODE_ENV: "development", AUTH_LOCAL_SETUP_CODE: "short" } }).config.setupCode, "");
});
