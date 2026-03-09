import { Type } from "@fastify/type-provider-typebox";
import { createResourceSchemaContract } from "@jskit-ai/http-runtime/shared/contracts";

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
const consoleSettingsPatchSchema = Type.Partial(consoleSettingsCreateSchema, { additionalProperties: false });

const consoleSettingsResourceContract = createResourceSchemaContract({
  record: consoleSettingsRecordSchema,
  create: consoleSettingsCreateSchema,
  replace: consoleSettingsReplaceSchema,
  patch: consoleSettingsPatchSchema
});

const schema = Object.freeze({
  body: {
    update: consoleSettingsResourceContract.replace
  },
  response: {
    settings: consoleSettingsResourceContract.record
  },
  resourceContracts: {
    consoleSettings: consoleSettingsResourceContract
  },
  commandContracts: {}
});

export { schema };
