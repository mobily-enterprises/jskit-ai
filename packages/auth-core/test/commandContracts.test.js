import test from "node:test";
import assert from "node:assert/strict";
import { authRegisterCommand } from "../src/shared/contracts/commands/authRegisterCommand.js";
import { authLoginPasswordCommand } from "../src/shared/contracts/commands/authLoginPasswordCommand.js";
import { authLoginOtpRequestCommand } from "../src/shared/contracts/commands/authLoginOtpRequestCommand.js";
import { authLoginOtpVerifyCommand } from "../src/shared/contracts/commands/authLoginOtpVerifyCommand.js";
import { authLoginOAuthStartCommand } from "../src/shared/contracts/commands/authLoginOAuthStartCommand.js";
import { authLoginOAuthCompleteCommand } from "../src/shared/contracts/commands/authLoginOAuthCompleteCommand.js";
import { authPasswordResetRequestCommand } from "../src/shared/contracts/commands/authPasswordResetRequestCommand.js";
import { authPasswordRecoveryCompleteCommand } from "../src/shared/contracts/commands/authPasswordRecoveryCompleteCommand.js";
import { authPasswordResetCommand } from "../src/shared/contracts/commands/authPasswordResetCommand.js";
import { authLogoutCommand } from "../src/shared/contracts/commands/authLogoutCommand.js";
import { authSessionReadCommand } from "../src/shared/contracts/commands/authSessionReadCommand.js";

test("auth command contracts expose canonical operation messages", () => {
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

  for (const [label, contract] of Object.entries(commands)) {
    assert.equal(typeof contract.operation?.messages, "object", `${label}.operation.messages must be an object.`);
  }
});
