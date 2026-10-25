import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

// Providers with custom paths or bodies share input validation, while retaining
// ownership of their request construction and response checks.
function validatedOperation(fields, build, validateResult, scopes = []) {
  const schema = createSchema(fields);
  return {
    scopes,
    request(input, settings = {}, providerData) {
      return build(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 }), settings, providerData);
    },
    validateResult
  };
}

// Copies validated values into a URL's query string.
function withQuery(url, values) {
  const destination = new URL(url);
  for (const [name, value] of Object.entries(values)) destination.searchParams.set(name, String(value));
  return destination.href;
}

// Provider endpoints with either query parameters or a JSON request body.
function jsonOperation(url, fields, validateResult, method = "GET") {
  return validatedOperation(fields, (values, settings) => {
    const endpoint = typeof url === "function" ? url(settings) : url;
    if (method === "POST") return { method, url: endpoint, body: values };
    return { method, url: withQuery(endpoint, values) };
  }, validateResult);
}

export { jsonOperation, validatedOperation, withQuery };
