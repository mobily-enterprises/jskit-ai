import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { catalogMessage, formatMessage, mergeCatalogs, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import authCoreEnglish from "@jskit-ai/auth-core/locales/en.json" with { type: "json" };
import localEnglish from "../locales/en.json" with { type: "json" };
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";
import { sessionCookies } from "../test-support/oauthHarness.js";
import { SCENARIO_START, codeAt } from "../test-support/secondFactorScenario.js";

const english = mergeCatalogs(authCoreEnglish, localEnglish);

function rendered(code, params = {}) {
  const template = catalogMessage(english, messageKeyForCode(code));
  assert.notEqual(template, undefined, `${code} has no English`);
  return formatMessage(template, params);
}

// Every coded text says exactly its catalog English, rendered with its params.
function assertCoded(error, code) {
  assert.equal(error.code, code);
  assert.equal(rendered(error.code, error.params), error.message);
  for (const [field, coded] of Object.entries(error.details?.fieldErrorCodes || {})) {
    assert.equal(rendered(coded.code, coded.params), error.details.fieldErrors[field], field);
  }
  return true;
}

async function createService(t, env = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-coded-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return createLocalAuthService({
    ...localServiceOptions({ env }),
    backend: createLocalFileBackend({ storeDir })
  });
}

test("local auth errors carry codes whose English is the thrown message", async (t) => {
  const service = await createService(t);
  await assert.rejects(() => service.register({ email: "nope", password: "long enough" }),
    (error) => assertCoded(error, "auth.local.email.invalid"));
  await assert.rejects(() => service.register({ email: "ada@example.com", password: "short" }),
    (error) => assertCoded(error, "auth.local.password.tooShort"));
  await service.register({ email: "ada@example.com", password: "correct horse" });
  await assert.rejects(() => service.register({ email: "ada@example.com", password: "correct horse" }),
    (error) => assertCoded(error, "auth.local.register.emailTaken"));
  await assert.rejects(() => service.login({ email: "ada@example.com", password: "wrong password" }),
    (error) => assertCoded(error, "auth.login.invalidCredentials"));
  await assert.rejects(() => service.completePasswordRecovery({}),
    (error) => assertCoded(error, "auth.recovery.tokenRequired"));
  await assert.rejects(() => service.completePasswordRecovery({ token: "unknown" }),
    (error) => assertCoded(error, "auth.local.recovery.tokenInvalid"));
  // A stored token hash is not the token: it never completes a recovery.
  await assert.rejects(() => service.completePasswordRecovery({ tokenHash: "stored-hash" }),
    (error) => assertCoded(error, "auth.recovery.tokenRequired"));
  await assert.rejects(() => service.updateDisplayName({ cookies: {} }, { displayName: "Ada" }),
    (error) => assertCoded(error, "auth.session.required"));

  const confirming = await createService(t, { AUTH_LOCAL_EMAIL_CONFIRMATION: "" });
  const waiting = await confirming.register({ email: "ada@example.com", password: "correct horse" });
  const token = new URL(waiting.confirmationUrl).searchParams.get("confirmation_token");
  await assert.rejects(() => confirming.confirmRegistration({ token: "unknown", password: "correct horse" }),
    (error) => assertCoded(error, "auth.local.register.confirmationInvalid"));
  await assert.rejects(() => confirming.confirmRegistration({ token, password: "wrong password" }),
    (error) => assertCoded(error, "auth.local.register.confirmationPasswordInvalid"));

  const disabled = await createService(t, { APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "" });
  await assert.rejects(() => disabled.requestPasswordReset({ email: "ada@example.com" }),
    (error) => assertCoded(error, "auth.local.recovery.notConfigured"));
});

test("local auth success texts carry a message code next to the English", async (t) => {
  const service = await createService(t);
  await service.register({ email: "ada@example.com", password: "correct horse" });
  const requested = await service.requestPasswordReset({ email: "ada@example.com" });
  assert.equal(requested.messageCode, "auth.local.recovery.requested");
  assert.equal(rendered(requested.messageCode, requested.messageParams), requested.message);
});

test("second factor refusals carry codes whose English is the thrown message", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
  const service = await createService(t);
  await service.register({ email: "ada@example.com", password: "correct horse" });
  const cookies = sessionCookies((await service.login({ email: "ada@example.com", password: "correct horse" })).session);
  const request = () => ({ cookies });
  const coded = (code) => (error) => assertCoded(error, code);

  await assert.rejects(service.verifySecondFactor(request(), { code: "123456" }), coded("auth.local.secondFactor.notSetUp"));
  await assert.rejects(service.confirmSecondFactorSetup(request(), { code: "123456" }), coded("auth.local.secondFactor.setupNotStarted"));
  const { secret } = await service.startSecondFactorSetup(request());
  await service.confirmSecondFactorSetup(request(), { code: codeAt(secret) });
  await assert.rejects(service.startSecondFactorSetup(request()), coded("auth.local.secondFactor.alreadySetUp"));
  await assert.rejects(service.verifySecondFactor(request(), {}), coded("auth.local.secondFactor.proofRequired"));
  await assert.rejects(service.verifySecondFactor(request(), { code: codeAt(secret) }), coded("auth.local.secondFactor.codeUsed"));
  await assert.rejects(service.verifySecondFactor(request(), { recoveryCode: "abcde-fghjk" }),
    coded("auth.local.secondFactor.recoveryCodeInvalid"));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(service.verifySecondFactor(request(), { code: "12345" }), coded("auth.local.secondFactor.codeInvalid"));
  }
  await assert.rejects(service.verifySecondFactor(request(), { code: codeAt(secret, 1) }), (error) => {
    assert.equal(error.message, "Too many wrong codes. Try again in 1 minute.");
    return assertCoded(error, "auth.local.secondFactor.locked");
  });
});
