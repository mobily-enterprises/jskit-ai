import { Type } from "typebox";
import {
  createCursorListValidator,
  normalizeObjectInput
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { createOperationMessages } from "../operationMessages.js";

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

const avatarUploadBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      mimeType: Type.Optional(
        Type.String({
          minLength: 1,
          messages: {
            default: "Avatar mimeType is invalid."
          }
        })
      ),
      fileName: Type.Optional(
        Type.String({
          minLength: 1,
          messages: {
            default: "Avatar fileName is invalid."
          }
        })
      ),
      uploadDimension: Type.Optional(
        Type.String({
          minLength: 1,
          messages: {
            default: "Avatar uploadDimension is invalid."
          }
        })
      )
    },
    { additionalProperties: true }
  ),
  normalize: normalizeObjectInput
});

const avatarDeleteBodyValidator = Object.freeze({
  schema: Type.Object({}, { additionalProperties: false }),
  normalize: normalizeObjectInput
});

const avatarOperationOutputValidator = Object.freeze({
  schema: Type.Object({}, { additionalProperties: true }),
  normalize: normalizeObjectInput
});

const USER_PROFILE_OPERATION_MESSAGES = createOperationMessages();

const userProfileResource = Object.freeze({
  resource: "userProfile",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      outputValidator: userProfileOutputValidator
    }),
    list: Object.freeze({
      method: "GET",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      outputValidator: createCursorListValidator(userProfileOutputValidator)
    }),
    create: Object.freeze({
      method: "POST",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: userProfileCreateBodySchema,
        normalize: normalizeProfileInput
      }),
      outputValidator: userProfileOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: userProfileCreateBodySchema,
        normalize: normalizeProfileInput
      }),
      outputValidator: userProfileOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: userProfilePatchBodySchema,
        normalize: normalizeProfileInput
      }),
      outputValidator: userProfileOutputValidator
    }),
    avatarUpload: Object.freeze({
      method: "POST",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      bodyValidator: avatarUploadBodyValidator,
      outputValidator: avatarOperationOutputValidator
    }),
    avatarDelete: Object.freeze({
      method: "DELETE",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      bodyValidator: avatarDeleteBodyValidator,
      outputValidator: avatarOperationOutputValidator
    })
  })
});

export { userProfileResource };
