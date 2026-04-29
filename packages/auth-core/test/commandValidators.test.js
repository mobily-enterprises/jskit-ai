import test from "node:test";
import assert from "node:assert/strict";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { authRegisterCommand } from "../src/shared/commands/authRegisterCommand.js";
import { authRegisterConfirmationResendCommand } from "../src/shared/commands/authRegisterConfirmationResendCommand.js";
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

test("auth commands expose canonical operation validator messages", () => {
  const commands = {
    authRegisterCommand,
    authRegisterConfirmationResendCommand,
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

test("oauth complete command allows provider-less session-pair callbacks", () => {
  const bodySchema = resolveStructuredSchemaTransportSchema(
    authLoginOAuthCompleteCommand.operation.body,
    {
      context: "auth login oauth complete body",
      defaultMode: "patch"
    }
  );
  const bodyRequired = Array.isArray(bodySchema?.required) ? bodySchema.required : [];
  assert.equal(bodyRequired.includes("provider"), false);

  const responseSchema = resolveStructuredSchemaTransportSchema(
    authLoginOAuthCompleteCommand.operation.response,
    {
      context: "auth login oauth complete response",
      defaultMode: "replace"
    }
  );
  const responseRequired = Array.isArray(responseSchema?.required) ? responseSchema.required : [];
  assert.equal(responseRequired.includes("provider"), false);
});

test("auth session and oauth start commands expose explicit nested response schemas", () => {
  const sessionResponseSchema = resolveStructuredSchemaTransportSchema(
    authSessionReadCommand.operation.response,
    {
      context: "auth session read response",
      defaultMode: "replace"
    }
  );
  const sessionUnavailableSchema = resolveStructuredSchemaTransportSchema(
    authSessionReadCommand.operation.unavailableResponse,
    {
      context: "auth session read unavailable response",
      defaultMode: "replace"
    }
  );
  const oauthStartResponseSchema = resolveStructuredSchemaTransportSchema(
    authLoginOAuthStartCommand.operation.response,
    {
      context: "auth login oauth start response",
      defaultMode: "replace"
    }
  );

  assert.equal(sessionResponseSchema.properties.oauthProviders.type, "array");
  assert.equal(sessionResponseSchema.properties.oauthProviders.items.type, "object");
  assert.equal(Array.isArray(sessionUnavailableSchema.properties.oauthDefaultProvider.anyOf), true);
  assert.equal(oauthStartResponseSchema.properties.provider.type, "string");
  assert.equal(oauthStartResponseSchema.properties.returnTo.type, "string");
  assert.equal(oauthStartResponseSchema.properties.url.type, "string");
});
