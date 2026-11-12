import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { AUTH_FIELD_MESSAGES, createCommandMessages, okOutputValidator } from "./authCommandValidators.js";

// The second factor's commands: reading it, setting up an authenticator, proving a code, and replacing its recovery
// codes or removing it with a proof. A code is an authenticator's six digits, which a person may type with spaces; a
// recovery code is ten letters and digits, which they may type with a hyphen.
const SECOND_FACTOR_CODE_MAX_LENGTH = 16;
const RECOVERY_CODE_MAX_LENGTH = 32;

const secondFactorCodeField = deepFreeze({ type: "string", minLength: 1, maxLength: SECOND_FACTOR_CODE_MAX_LENGTH });
const recoveryCodeField = deepFreeze({ type: "string", minLength: 1, maxLength: RECOVERY_CODE_MAX_LENGTH });
const isoTextField = deepFreeze({ type: "string", minLength: 1, maxLength: 64 });

const SECOND_FACTOR_CODE_MESSAGES = createCommandMessages({
  fields: {
    code: {
      required: AUTH_FIELD_MESSAGES.secondFactorCodeRequired,
      default: AUTH_FIELD_MESSAGES.secondFactorCodeRequired
    }
  }
});

// A proof is a code or a recovery code; the provider refuses one that gives neither or both.
const SECOND_FACTOR_PROOF_MESSAGES = createCommandMessages({
  fields: {
    code: {
      default: AUTH_FIELD_MESSAGES.secondFactorCodeRequired
    },
    recoveryCode: {
      default: AUTH_FIELD_MESSAGES.recoveryCodeInvalid
    }
  }
});

const secondFactorCodeBodyValidator = deepFreeze({
  schema: createSchema({
    code: { ...secondFactorCodeField, required: true }
  }),
  mode: "create",
  messages: SECOND_FACTOR_CODE_MESSAGES
});

const secondFactorProofBodyValidator = deepFreeze({
  schema: createSchema({
    code: { ...secondFactorCodeField, required: false },
    recoveryCode: { ...recoveryCodeField, required: false }
  }),
  mode: "create",
  messages: SECOND_FACTOR_PROOF_MESSAGES
});

const secondFactorStatusOutputValidator = deepFreeze({
  schema: createSchema({
    enrolled: { type: "boolean", required: true },
    enrolledAt: { ...isoTextField, required: true, nullable: true },
    recoveryCodesLeft: { type: "integer", required: true, min: 0 },
    // When the request's session last proved its second factor.
    verifiedAt: { ...isoTextField, required: true, nullable: true }
  }),
  mode: "replace"
});

const secondFactorSetupOutputValidator = deepFreeze({
  schema: createSchema({
    // The authenticator's secret in base32, shown once for a person to type; otpauthUrl carries it for a QR code.
    secret: { type: "string", required: true, minLength: 16, maxLength: 128 },
    otpauthUrl: { type: "string", required: true, minLength: 1, maxLength: 1024 },
    issuer: { type: "string", required: true, minLength: 1, maxLength: 255 },
    accountName: { type: "string", required: true, minLength: 1, maxLength: 320 }
  }),
  mode: "replace"
});

// New recovery codes, shown once: only their hashes are kept.
const secondFactorRecoveryCodesOutputValidator = deepFreeze({
  schema: createSchema({
    recoveryCodes: { type: "array", required: true, items: { type: "string", minLength: 1, maxLength: RECOVERY_CODE_MAX_LENGTH } },
    verifiedAt: { ...isoTextField, required: true }
  }),
  mode: "replace"
});

const secondFactorVerifyOutputValidator = deepFreeze({
  schema: createSchema({
    verifiedAt: { ...isoTextField, required: true },
    method: { type: "string", required: true, enum: ["code", "recoveryCode"] },
    recoveryCodesLeft: { type: "integer", required: true, min: 0 }
  }),
  mode: "replace"
});

const READ_INVALIDATES = Object.freeze(["auth.secondFactor.read"]);

const authSecondFactorReadCommand = deepFreeze({
  command: "auth.secondFactor.read",
  operation: {
    method: "GET",
    response: secondFactorStatusOutputValidator,
    messages: createCommandMessages(),
    idempotent: true,
    invalidates: []
  }
});

const authSecondFactorSetupStartCommand = deepFreeze({
  command: "auth.secondFactor.setup.start",
  operation: {
    method: "POST",
    response: secondFactorSetupOutputValidator,
    messages: createCommandMessages(),
    idempotent: false,
    invalidates: READ_INVALIDATES
  }
});

const authSecondFactorSetupConfirmCommand = deepFreeze({
  command: "auth.secondFactor.setup.confirm",
  operation: {
    method: "POST",
    body: secondFactorCodeBodyValidator,
    response: secondFactorRecoveryCodesOutputValidator,
    messages: SECOND_FACTOR_CODE_MESSAGES,
    idempotent: false,
    invalidates: READ_INVALIDATES
  }
});

const authSecondFactorVerifyCommand = deepFreeze({
  command: "auth.secondFactor.verify",
  operation: {
    method: "POST",
    body: secondFactorProofBodyValidator,
    response: secondFactorVerifyOutputValidator,
    messages: SECOND_FACTOR_PROOF_MESSAGES,
    idempotent: false,
    invalidates: READ_INVALIDATES
  }
});

const authSecondFactorRecoveryCodesReplaceCommand = deepFreeze({
  command: "auth.secondFactor.recoveryCodes.replace",
  operation: {
    method: "POST",
    body: secondFactorProofBodyValidator,
    response: secondFactorRecoveryCodesOutputValidator,
    messages: SECOND_FACTOR_PROOF_MESSAGES,
    idempotent: false,
    invalidates: READ_INVALIDATES
  }
});

const authSecondFactorRemoveCommand = deepFreeze({
  command: "auth.secondFactor.remove",
  operation: {
    method: "DELETE",
    body: secondFactorProofBodyValidator,
    response: okOutputValidator,
    messages: SECOND_FACTOR_PROOF_MESSAGES,
    idempotent: false,
    invalidates: READ_INVALIDATES
  }
});

export {
  authSecondFactorReadCommand,
  authSecondFactorRecoveryCodesReplaceCommand,
  authSecondFactorRemoveCommand,
  authSecondFactorSetupConfirmCommand,
  authSecondFactorSetupStartCommand,
  authSecondFactorVerifyCommand
};
