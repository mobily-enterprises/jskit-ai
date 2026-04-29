import { createSchema } from "json-rest-schema";
import {
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const RESOURCE_LOOKUP_CONTAINER_KEY = "lookups";

const recordOutputSchema = createSchema({
  id: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  textField: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 160
  },
  dateField: {
    type: "dateTime",
    required: true
  },
  numberField: {
    type: "number",
    required: true
  },
  createdAt: {
    type: "dateTime",
    required: true
  },
  updatedAt: {
    type: "dateTime",
    required: true
  },
  [RESOURCE_LOOKUP_CONTAINER_KEY]: {
    type: "object",
    required: false
  }
});

const createBodySchema = createSchema({
  textField: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 160,
    messages: {
      required: "Text field is required.",
      minLength: "Text field is required.",
      maxLength: "Text field must be at most 160 characters.",
      default: "Text field is required."
    }
  },
  dateField: {
    type: "dateTime",
    required: true,
    messages: {
      required: "Date field is required.",
      default: "Date field is required."
    }
  },
  numberField: {
    type: "number",
    required: true,
    messages: {
      required: "Number field is required.",
      default: "Number field must be a valid number."
    }
  }
});

const patchBodySchema = createSchema({
  textField: {
    type: "string",
    required: false,
    minLength: 1,
    maxLength: 160,
    messages: {
      minLength: "Text field is required.",
      maxLength: "Text field must be at most 160 characters.",
      default: "Text field is required."
    }
  },
  dateField: {
    type: "dateTime",
    required: false,
    messages: {
      default: "Date field is required."
    }
  },
  numberField: {
    type: "number",
    required: false,
    messages: {
      default: "Number field must be a valid number."
    }
  }
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

const crudResource = deepFreeze({
  namespace: "crud",
  tableName: "crud",
  idColumn: "id",
  messages: {
    validation: "Fix invalid CRUD values and try again.",
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
        events: ["crud.record.changed"]
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

export { crudResource };
