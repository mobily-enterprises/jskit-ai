import { createSchema } from "json-rest-schema";

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

const emptyInputValidator = Object.freeze({
  schema: createSchema({}),
  mode: "replace"
});

export {
  resolveRequest,
  emptyInputValidator
};
