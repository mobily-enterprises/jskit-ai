import { Type } from "typebox";
import { createOperationMessages } from "../contracts/contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

const consoleSettingsValueSchema = Type.Object(
  {
    assistantSystemPromptWorkspace: Type.String()
  },
  { additionalProperties: false }
);

const consoleSettingsRecordSchema = Type.Object(
  {
    settings: consoleSettingsValueSchema
  },
  { additionalProperties: false }
);

const consoleSettingsCreateSchema = Type.Object(
  {
    assistantSystemPromptWorkspace: Type.String()
  },
  { additionalProperties: false }
);

const consoleSettingsReplaceSchema = consoleSettingsCreateSchema;
const consoleSettingsPatchSchema = Type.Partial(consoleSettingsCreateSchema, {
  additionalProperties: false
});

const consoleSettingsListSchema = Type.Object(
  {
    items: Type.Array(consoleSettingsRecordSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

const CONSOLE_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const consoleSettingsResource = Object.freeze({
  resource: "consoleSettings",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: consoleSettingsRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: consoleSettingsListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: consoleSettingsCreateSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: consoleSettingsRecordSchema
      })
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: consoleSettingsReplaceSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: consoleSettingsRecordSchema
      })
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: consoleSettingsPatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: consoleSettingsRecordSchema
      })
    })
  })
});

export { consoleSettingsResource };
