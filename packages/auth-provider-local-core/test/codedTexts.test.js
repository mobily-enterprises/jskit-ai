import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { catalogMessage, formatMessage, mergeCatalogs, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import authCoreEnglish from "@jskit-ai/auth-core/locales/en.json" with { type: "json" };
import localEnglish from "../locales/en.json" with { type: "json" };
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";

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

async function createService(config = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-coded-"));
  return createLocalAuthService({
    backend: createLocalFileBackend({ storeDir }),
    config: {
      sessionSecret: "coded-texts-secret",
      nodeEnv: "test",
      appPublicUrl: "http://localhost:5173",
      recoveryDevOutput: "response",
      ...config
    }
  });
}

test("local auth errors carry codes whose English is the thrown message", async () => {
  const service = await createService();
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
  await assert.rejects(() => service.updateDisplayName({ cookies: {} }, { displayName: "Ada" }),
    (error) => assertCoded(error, "auth.session.required"));

  const disabled = await createService({ nodeEnv: "production", recoveryDevOutput: "log" });
  await assert.rejects(() => disabled.requestPasswordReset({ email: "ada@example.com" }),
    (error) => assertCoded(error, "auth.local.recovery.notConfigured"));
});

test("local auth success texts carry a message code next to the English", async () => {
  const service = await createService();
  await service.register({ email: "ada@example.com", password: "correct horse" });
  const requested = await service.requestPasswordReset({ email: "ada@example.com" });
  assert.equal(requested.messageCode, "auth.local.recovery.requested");
  assert.equal(rendered(requested.messageCode, requested.messageParams), requested.message);
});
