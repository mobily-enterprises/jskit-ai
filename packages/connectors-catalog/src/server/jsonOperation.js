import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

// Providers with custom paths or bodies share input validation, while retaining
// ownership of their request construction and response checks.
function validatedOperation(fields, build, validateResult) {
  const schema = createSchema(fields);
  return {
    scopes: [],
    request(input) {
      return build(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 }));
    },
    validateResult
  };
}

// Provider endpoints with either query parameters or a JSON request body.
function jsonOperation(url, fields, validateResult, method = "GET") {
  const schema = createSchema(fields);
  return {
    scopes: [],
    request(input, settings = {}) {
      const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const endpoint = typeof url === "function" ? url(settings) : url;
      if (method === "POST") return { method, url: endpoint, body: values };
      const destination = new URL(endpoint);
      for (const [name, value] of Object.entries(values)) destination.searchParams.set(name, String(value));
      return { method, url: destination.href };
    },
    validateResult
  };
}

export { jsonOperation, validatedOperation };
