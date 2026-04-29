import { createSchema } from "json-rest-schema";
import {
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

const recordOutput = deepFreeze({
  schema: recordOutputSchema,
  mode: "replace"
});

const listOutput = createCursorListValidator(recordOutput);

const createBody = deepFreeze({
  schema: createBodySchema,
  mode: "create"
});

const patchBody = deepFreeze({
  schema: patchBodySchema,
  mode: "patch"
});

const deleteOutput = deepFreeze({
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
      output: listOutput
    },
    view: {
      method: "GET",
      output: recordOutput
    },
    create: {
      method: "POST",
      body: createBody,
      output: recordOutput
    },
    patch: {
      method: "PATCH",
      body: patchBody,
      output: recordOutput
    },
    delete: {
      method: "DELETE",
      output: deleteOutput
    }
  }
});

export { resource };
