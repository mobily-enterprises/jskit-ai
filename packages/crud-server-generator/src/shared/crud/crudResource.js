import {
  createSchema,
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

export { crudResource };
