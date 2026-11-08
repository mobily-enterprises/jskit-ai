import test from "node:test";
import assert from "node:assert/strict";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { authRegisterCommand } from "../src/shared/commands/authRegisterCommand.js";
import { authRegisterConfirmationResendCommand } from "../src/shared/commands/authRegisterConfirmationResendCommand.js";
import { authRegisterConfirmCommand } from "../src/shared/commands/authRegisterConfirmCommand.js";
import { authLoginPasswordCommand } from "../src/shared/commands/authLoginPasswordCommand.js";
import { authLoginOtpRequestCommand } from "../src/shared/commands/authLoginOtpRequestCommand.js";
import { authLoginOtpVerifyCommand } from "../src/shared/commands/authLoginOtpVerifyCommand.js";
import { authLoginOAuthStartCommand } from "../src/shared/commands/authLoginOAuthStartCommand.js";
import { authLoginOAuthCompleteCommand } from "../src/shared/commands/authLoginOAuthCompleteCommand.js";
import { authPasswordResetRequestCommand } from "../src/shared/commands/authPasswordResetRequestCommand.js";
import { authPasswordRecoveryCompleteCommand } from "../src/shared/commands/authPasswordRecoveryCompleteCommand.js";
import { authPasswordResetCommand } from "../src/shared/commands/authPasswordResetCommand.js";
import { authLogoutCommand } from "../src/shared/commands/authLogoutCommand.js";
import { authSessionReadCommand } from "../src/shared/commands/authSessionReadCommand.js";
import { authDevLoginAsCommand } from "../src/shared/commands/authDevLoginAsCommand.js";
import { catalogMessage, formatMessage, mergeCatalogs, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import kernelEnglish from "@jskit-ai/kernel/locales/en.json" with { type: "json" };
import authEnglish from "../locales/en.json" with { type: "json" };

test("auth commands expose canonical operation validator messages", () => {
  const commands = {
    authRegisterCommand,
    authRegisterConfirmationResendCommand,
    authRegisterConfirmCommand,
    authLoginPasswordCommand,
    authLoginOtpRequestCommand,
    authLoginOtpVerifyCommand,
    authLoginOAuthStartCommand,
    authLoginOAuthCompleteCommand,
    authPasswordResetRequestCommand,
    authPasswordRecoveryCompleteCommand,
    authPasswordResetCommand,
    authLogoutCommand,
    authSessionReadCommand
  };

  for (const [label, command] of Object.entries(commands)) {
    assert.equal(typeof command.operation?.messages, "object", `${label}.operation.messages must be an object.`);
  }
});

function* messageEntries(value, path) {
  if (value && typeof value === "object" && typeof value.code === "string") {
    yield [path, value];
    return;
  }
  for (const [name, child] of Object.entries(value || {})) {
    yield* messageEntries(child, `${path}.${name}`);
  }
}

test("every auth command message is coded and its English renders from the catalog", () => {
  const english = mergeCatalogs(kernelEnglish, authEnglish);
  const commands = [
    authRegisterCommand,
    authRegisterConfirmationResendCommand,
    authRegisterConfirmCommand,
    authLoginPasswordCommand,
    authLoginOtpRequestCommand,
    authLoginOtpVerifyCommand,
    authLoginOAuthStartCommand,
    authLoginOAuthCompleteCommand,
    authPasswordResetRequestCommand,
    authPasswordRecoveryCompleteCommand,
    authPasswordResetCommand,
    authLogoutCommand,
    authSessionReadCommand,
    authDevLoginAsCommand
  ];
  const sources = commands.flatMap((command) => [
    [`${command.command}.messages`, command.operation.messages],
    ...(command.operation.body ? [[`${command.command}.body.messages`, command.operation.body.messages]] : [])
  ]);
  let checked = 0;
  for (const [label, messages] of sources) {
    const strings = JSON.stringify(messages).match(/"[^"]*":"[^"]*"/g) || [];
    assert.deepEqual(strings.filter((entry) => !/^"(code|message)":/.test(entry)), [], `${label} has an uncoded message`);
    for (const [path, entry] of messageEntries(messages, label)) {
      const template = catalogMessage(english, messageKeyForCode(entry.code));
      assert.equal(typeof template, "string", `${path}: ${entry.code} has no catalog entry`);
      assert.equal(formatMessage(template, entry.params), entry.message, path);
      checked += 1;
    }
  }
  assert.ok(checked > 60);
});

test("oauth complete command allows provider-less session-pair callbacks", () => {
  const bodySchema = resolveSchemaTransportSchemaDefinition(
    authLoginOAuthCompleteCommand.operation.body,
    {
      context: "auth login oauth complete body",
      defaultMode: "patch"
    }
  );
  const bodyRequired = Array.isArray(bodySchema?.required) ? bodySchema.required : [];
  assert.equal(bodyRequired.includes("provider"), false);

  const responseSchema = resolveSchemaTransportSchemaDefinition(
    authLoginOAuthCompleteCommand.operation.response,
    {
      context: "auth login oauth complete response",
      defaultMode: "replace"
    }
  );
  const responseRequired = Array.isArray(responseSchema?.required) ? responseSchema.required : [];
  assert.equal(responseRequired.includes("provider"), false);
});

test("auth command body validators lowercase email inputs", () => {
  const commands = [
    authRegisterCommand,
    authRegisterConfirmationResendCommand,
    authLoginPasswordCommand,
    authLoginOtpRequestCommand,
    authLoginOtpVerifyCommand,
    authPasswordResetRequestCommand
  ];

  for (const command of commands) {
    const result = command.operation.body.schema.patch({
      email: "  ADA@EXAMPLE.COM  "
    });
    if (Object.hasOwn(result.validatedObject, "email")) {
      assert.equal(result.validatedObject.email, "ada@example.com");
    }
  }
});

test("registration takes the first account's setup code and confirmation takes its link's code and password", () => {
  const registered = authRegisterCommand.operation.body.schema.create({
    email: "owner@example.com",
    password: "correct horse battery staple",
    setupCode: "ABCDE-FGHJK-MNPQR-STVWX"
  });
  assert.equal(registered.validatedObject.setupCode, "ABCDE-FGHJK-MNPQR-STVWX");
  const confirmBody = authRegisterConfirmCommand.operation.body.schema;
  assert.deepEqual(Object.keys(confirmBody.create({ token: "code", password: "correct horse" }).validatedObject), [
    "token",
    "password"
  ]);
  // The link's code alone does not confirm: the registration's password is required.
  assert.deepEqual(Object.keys(confirmBody.create({ token: "code" }).errors), ["password"]);
  assert.deepEqual(Object.keys(confirmBody.create({ token: "code", password: "" }).errors), ["password"]);
});

test("auth session and oauth start commands expose explicit nested response schemas", () => {
  const sessionResponseSchema = resolveSchemaTransportSchemaDefinition(
    authSessionReadCommand.operation.response,
    {
      context: "auth session read response",
      defaultMode: "replace"
    }
  );
  const sessionUnavailableSchema = resolveSchemaTransportSchemaDefinition(
    authSessionReadCommand.operation.unavailableResponse,
    {
      context: "auth session read unavailable response",
      defaultMode: "replace"
    }
  );
  const oauthStartResponseSchema = resolveSchemaTransportSchemaDefinition(
    authLoginOAuthStartCommand.operation.response,
    {
      context: "auth login oauth start response",
      defaultMode: "replace"
    }
  );

  assert.equal(sessionResponseSchema.properties.oauthProviders.type, "array");
  assert.equal(sessionResponseSchema.properties.oauthProviders.items["x-json-rest-schema"]?.castType, "object");
  assert.equal(Array.isArray(sessionResponseSchema.properties.oauthProviders.items.allOf), true);
  assert.match(sessionResponseSchema.properties.oauthProviders.items.allOf[0]?.$ref || "", /^#\/definitions\//);
  assert.equal(sessionResponseSchema.properties.authCapabilities["x-json-rest-schema"]?.castType, "object");
  assert.equal(Array.isArray(sessionResponseSchema.properties.authCapabilities.allOf), true);
  assert.match(sessionResponseSchema.properties.authCapabilities.allOf[0]?.$ref || "", /^#\/definitions\//);
  assert.equal(sessionResponseSchema.properties.authDenied["x-json-rest-schema"]?.castType, "object");
  assert.equal(Array.isArray(sessionResponseSchema.properties.authDenied.allOf), true);
  assert.match(sessionResponseSchema.properties.authDenied.allOf[0]?.$ref || "", /^#\/definitions\//);
  assert.equal(sessionUnavailableSchema.properties.authCapabilities["x-json-rest-schema"]?.castType, "object");
  assert.equal(Array.isArray(sessionUnavailableSchema.properties.authCapabilities.allOf), true);
  assert.equal(Array.isArray(sessionUnavailableSchema.properties.oauthDefaultProvider.anyOf), true);
  assert.equal(oauthStartResponseSchema.properties.provider.type, "string");
  assert.equal(oauthStartResponseSchema.properties.returnTo.type, "string");
  assert.equal(oauthStartResponseSchema.properties.url.type, "string");
});
