import { createSchema } from "json-rest-schema";
import { createCursorListValidator } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { createOperationMessages } from "../operationMessages.js";

const userProfileOutputSchema = createSchema({
  displayName: { type: "string", required: true, minLength: 1, maxLength: 160 },
  email: { type: "string", required: true, minLength: 1, maxLength: 255 },
  emailManagedBy: { type: "string", required: false, minLength: 1, maxLength: 64 },
  emailChangeFlow: { type: "string", required: false, minLength: 1, maxLength: 64 }
});

const userProfileOutput = deepFreeze({
  schema: userProfileOutputSchema,
  mode: "replace"
});

const userProfileBodySchema = createSchema({
  displayName: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 120
  }
});

const avatarUploadBody = deepFreeze({
  schema: createSchema({
    mimeType: {
      type: "string",
      required: false,
      minLength: 1,
      messages: {
        default: "Avatar mimeType is invalid."
      }
    },
    fileName: {
      type: "string",
      required: false,
      minLength: 1,
      messages: {
        default: "Avatar fileName is invalid."
      }
    },
    uploadDimension: {
      type: "string",
      required: false,
      minLength: 1,
      messages: {
        default: "Avatar uploadDimension is invalid."
      }
    }
  }),
  mode: "patch"
});

const avatarDeleteBody = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const avatarOperationOutput = deepFreeze({
  schema: {
    type: "object",
    additionalProperties: true
  }
});

const USER_PROFILE_OPERATION_MESSAGES = createOperationMessages();

const userProfileResource = deepFreeze({
  namespace: "userProfile",
  operations: {
    view: {
      method: "GET",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      output: userProfileOutput
    },
    list: {
      method: "GET",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      output: createCursorListValidator(userProfileOutput)
    },
    create: {
      method: "POST",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: {
        schema: userProfileBodySchema,
        mode: "create"
      },
      output: userProfileOutput
    },
    replace: {
      method: "PUT",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: {
        schema: userProfileBodySchema,
        mode: "replace"
      },
      output: userProfileOutput
    },
    patch: {
      method: "PATCH",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: {
        schema: userProfileBodySchema,
        mode: "patch"
      },
      output: userProfileOutput
    },
    avatarUpload: {
      method: "POST",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: avatarUploadBody,
      output: avatarOperationOutput
    },
    avatarDelete: {
      method: "DELETE",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: avatarDeleteBody,
      output: avatarOperationOutput
    }
  }
});

export { userProfileResource };
export { userProfileOutputSchema };
