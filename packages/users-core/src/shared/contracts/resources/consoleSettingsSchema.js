import { Type } from "typebox";
import {
  buildResourceRequiredMetadata,
  normalizeObjectInput
} from "../contractUtils.js";

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

const consoleSettingsSchema = Object.freeze({
  resource: "consoleSettings",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: consoleSettingsRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: consoleSettingsListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
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
      body: Object.freeze({
        schema: consoleSettingsPatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: consoleSettingsRecordSchema
      })
    })
  }),
  required: buildResourceRequiredMetadata({
    create: consoleSettingsCreateSchema,
    replace: consoleSettingsReplaceSchema,
    patch: consoleSettingsPatchSchema
  })
});

export {
  consoleSettingsValueSchema,
  consoleSettingsRecordSchema,
  consoleSettingsCreateSchema,
  consoleSettingsReplaceSchema,
  consoleSettingsPatchSchema,
  consoleSettingsListSchema,
  consoleSettingsSchema
};
