import { createSchema } from "json-rest-schema";
import { createCursorListValidator } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { createOperationMessages } from "../operationMessages.js";
import {
  userProfileOutputSchema
} from "./accountSettingsSchemas.js";
import {
  userSettingsOutputValidator
} from "./userSettingsResource.js";

const userProfileOutputValidator = deepFreeze({
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

const avatarUploadBodyValidator = deepFreeze({
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

const avatarDeleteBodyValidator = deepFreeze({
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
      output: userProfileOutputValidator
    },
    list: {
      method: "GET",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      output: createCursorListValidator(userProfileOutputValidator)
    },
    create: {
      method: "POST",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: {
        schema: userProfileBodySchema,
        mode: "create"
      },
      output: userProfileOutputValidator
    },
    replace: {
      method: "PUT",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: {
        schema: userProfileBodySchema,
        mode: "replace"
      },
      output: userProfileOutputValidator
    },
    patch: {
      method: "PATCH",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: {
        schema: userProfileBodySchema,
        mode: "patch"
      },
      output: userProfileOutputValidator
    },
    avatarUpload: {
      method: "POST",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: avatarUploadBodyValidator,
      output: userSettingsOutputValidator
    },
    avatarDelete: {
      method: "DELETE",
      messages: USER_PROFILE_OPERATION_MESSAGES,
      body: avatarDeleteBodyValidator,
      output: userSettingsOutputValidator
    }
  }
});

export { userProfileResource };
