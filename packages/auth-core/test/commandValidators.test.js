import test from "node:test";
import assert from "node:assert/strict";
import { authRegisterCommand } from "../src/shared/commands/authRegisterCommand.js";
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
