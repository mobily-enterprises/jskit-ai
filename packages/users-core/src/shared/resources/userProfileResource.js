import { createSchema } from "json-rest-schema";
import { createCursorListValidator } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { createOperationMessages } from "../operationMessages.js";
import {
  userProfileOutputSchema
} from "./accountSettingsSchemas.js";
import {
  userSettingsOutputDefinition
} from "./userSettingsResource.js";

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
      output: userSettingsOutputDefinition
    },
    avatarDelete: {
      method: "DELETE",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: avatarDeleteBody,
      output: userSettingsOutputDefinition
    }
  }
});

export { userProfileResource };
export { userProfileOutputSchema };
