import { Type } from "typebox";
import {
  createCursorListValidator,
  normalizeObjectInput
} from "@jskit-ai/kernel/shared/contracts";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { createOperationMessages } from "../contracts/contractUtils.js";

function normalizeProfileInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "displayName")) {
    normalized.displayName = normalizeText(source.displayName);
  }

  return normalized;
}

const userProfileOutputSchema = Type.Object(
  {
    displayName: Type.String(),
    email: Type.String(),
    emailManagedBy: Type.Optional(Type.String()),
    emailChangeFlow: Type.Optional(Type.String()),
    avatar: Type.Optional(Type.Object({}, { additionalProperties: true }))
  },
  { additionalProperties: true }
);

const userProfileOutputValidator = Object.freeze({
  schema: userProfileOutputSchema,
  normalize: normalizeObjectInput
});

const userProfileCreateBodySchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 })
  },
  { additionalProperties: false }
);

const userProfilePatchBodySchema = Type.Partial(userProfileCreateBodySchema, {
  additionalProperties: false,
  minProperties: 1
});

const USER_PROFILE_OPERATION_MESSAGES = createOperationMessages();

const userProfileResource = Object.freeze({
  resource: "userProfile",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      output: userProfileOutputValidator
    }),
    list: Object.freeze({
      method: "GET",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      output: createCursorListValidator(userProfileOutputValidator)
    }),
    create: Object.freeze({
      method: "POST",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userProfileCreateBodySchema,
        normalize: normalizeProfileInput
      }),
      output: userProfileOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userProfileCreateBodySchema,
        normalize: normalizeProfileInput
      }),
      output: userProfileOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userProfilePatchBodySchema,
        normalize: normalizeProfileInput
      }),
      output: userProfileOutputValidator
    })
  })
});

export { userProfileResource };
