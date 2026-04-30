import {
  createSchema,
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const RESOURCE_LOOKUP_CONTAINER_KEY = "lookups";

const recordOutputSchema = createSchema({
__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__
  [RESOURCE_LOOKUP_CONTAINER_KEY]: {
    type: "object",
    required: false
  }
});

const createBodySchema = createSchema({
__JSKIT_CRUD_RESOURCE_CREATE_SCHEMA_PROPERTIES__
});

const patchBodySchema = createSchema({
__JSKIT_CRUD_RESOURCE_PATCH_SCHEMA_PROPERTIES__
});

const recordOutputValidator = deepFreeze({
  schema: recordOutputSchema,
  mode: "replace"
});

const listOutputValidator = createCursorListValidator(recordOutputValidator);

const createBodyValidator = deepFreeze({
  schema: createBodySchema,
  mode: "create"
});

const patchBodyValidator = deepFreeze({
  schema: patchBodySchema,
  mode: "patch"
});

const deleteOutputValidator = deepFreeze({
  schema: createSchema({
    id: {
      type: "string",
      required: true,
      minLength: 1,
      pattern: RECORD_ID_PATTERN
    },
    deleted: {
      type: "boolean",
      required: true
    }
  }),
  mode: "replace"
});

const resource = deepFreeze({
  namespace: "${option:namespace|snake}",
  tableName: __JSKIT_CRUD_TABLE_NAME__,
  idColumn: __JSKIT_CRUD_ID_COLUMN__,
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  contract: {
    lookup: {
      containerKey: RESOURCE_LOOKUP_CONTAINER_KEY,
      defaultInclude: "*",
      maxDepth: 3
    }
  },
  operations: {
    list: {
      realtime: {
        events: ["${option:namespace|snake}.record.changed"]
      },
      method: "GET",
      output: listOutputValidator
    },
    view: {
      method: "GET",
      output: recordOutputValidator
    },
    create: {
      method: "POST",
      body: createBodyValidator,
      output: recordOutputValidator
    },
    patch: {
      method: "PATCH",
      body: patchBodyValidator,
      output: recordOutputValidator
    },
    delete: {
      method: "DELETE",
      output: deleteOutputValidator
    }
  }
});

export { resource };
