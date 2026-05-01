import { defineCrudResource } from "@jskit-ai/crud-core/shared/crudResource";

const crudResource = defineCrudResource({
  namespace: "crud",
  tableName: "crud",
  schema: {
    textField: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 160,
      operations: {
        output: { required: true },
        create: {
          required: true,
          messages: {
            required: "Text field is required.",
            minLength: "Text field is required.",
            maxLength: "Text field must be at most 160 characters.",
            default: "Text field is required."
          }
        },
        patch: {
          required: false,
          messages: {
            minLength: "Text field is required.",
            maxLength: "Text field must be at most 160 characters.",
            default: "Text field is required."
          }
        }
      }
    },
    dateField: {
      type: "dateTime",
      required: true,
      operations: {
        output: { required: true },
        create: {
          required: true,
          messages: {
            required: "Date field is required.",
            default: "Date field is required."
          }
        },
        patch: {
          required: false,
          messages: {
            default: "Date field is required."
          }
        }
      }
    },
    numberField: {
      type: "number",
      required: true,
      operations: {
        output: { required: true },
        create: {
          required: true,
          messages: {
            required: "Number field is required.",
            default: "Number field must be a valid number."
          }
        },
        patch: {
          required: false,
          messages: {
            default: "Number field must be a valid number."
          }
        }
      }
    },
    createdAt: {
      type: "dateTime",
      required: true,
      operations: {
        output: { required: true }
      }
    },
    updatedAt: {
      type: "dateTime",
      required: true,
      operations: {
        output: { required: true }
      }
    }
  },
  messages: {
    validation: "Fix invalid CRUD values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  contract: {
    lookup: {
      containerKey: "lookups",
      defaultInclude: "*",
      maxDepth: 3
    }
  }
});

export { crudResource };
