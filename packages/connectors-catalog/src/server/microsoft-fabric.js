import { isDeepStrictEqual } from "node:util";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { microsoftFabricDefinition, delegatedScope, serviceScope } from "../shared/microsoft-fabric.js";
import { jsonOperation } from "./jsonOperation.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const name = (value) => typeof value === "string" && /^[_A-Za-z][_0-9A-Za-z]*$/u.test(value);
const validResult = (value) => object(value?.data) &&
  (value.errors === undefined || (Array.isArray(value.errors) && value.errors.length === 0));
const endpoint = (settings) => settings.graphqlEndpoint;
const permissions = [delegatedScope, serviceScope];

function fixedQuery(query, validateData) {
  const operation = jsonOperation(endpoint, {}, (value) => validResult(value) && validateData(value.data), "POST");
  return { ...operation, scopes: permissions, request(input, settings) {
    return { ...operation.request(input, settings), body: { query } };
  } };
}

const microsoftFabricProvider = Object.freeze({
  ...microsoftFabricDefinition,
  oauth: ({ tenantId }) => ({
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    token_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  }),
  authorizationParameters: { response_mode: "query" },
  apiOrigins: ["https://api.fabric.microsoft.com"], checkOperation: "connection.check",
  async normalizeTokenResponse(response) {
    if (!response.ok) {
      let error;
      try { error = (await response.clone().json())?.error; } catch { /* OAuth handles the response */ }
      if (["interaction_required", "login_required", "consent_required"].includes(error)) {
        throw new ConnectorError("connector_reconnect_required", "Microsoft requires a new sign-in or consent.", { statusCode: 401 });
      }
      return response;
    }
    let value;
    try { value = await response.clone().json(); } catch { /* rejected below */ }
    if (!Number.isSafeInteger(value?.expires_in) || value.expires_in <= 30 ||
      (value.scope !== undefined && (typeof value.scope !== "string" || !/^[^\s]+(?: [^\s]+)*$/u.test(value.scope)))) {
      throw new ConnectorError("connector_response_invalid", "Microsoft returned an invalid token grant.", { statusCode: 502 });
    }
    // Entra may return the permission name without the resource URI requested in consent.
    if (value.scope?.split(" ").includes("GraphQLApi.Execute.All")) {
      value.scope = value.scope.split(" ").map((scope) => scope === "GraphQLApi.Execute.All" ? delegatedScope : scope).join(" ");
      return Response.json(value, { status: response.status });
    }
    return response;
  },
  operations: {
    "connection.check": fixedQuery("query ConnectorFabricCheck { __typename }", (data) => name(data.__typename)),
    "schema.types": fixedQuery("query ConnectorFabricTypes { __schema { types { name kind } queryType { name } mutationType { name } } }",
      (data) => object(data.__schema) && Array.isArray(data.__schema.types) && data.__schema.types.every((type) => name(type?.name) &&
        ["SCALAR", "OBJECT", "INTERFACE", "UNION", "ENUM", "INPUT_OBJECT", "LIST", "NON_NULL"].includes(type.kind)) &&
        name(data.__schema.queryType?.name) && (data.__schema.mutationType === null || name(data.__schema.mutationType?.name))),
    "graphql.execute": {
      ...jsonOperation(endpoint, {
        query: { type: "string", required: true, minLength: 1, maxLength: 65_536, validator: (value) => value.trim().length > 0 || "Provide a GraphQL document." },
        variables: { type: "object", additionalProperties: true, validator(value) {
          try {
            const encoded = JSON.stringify(value);
            if (encoded.length <= 65_536 && isDeepStrictEqual(value, JSON.parse(encoded))) return true;
          } catch { /* invalid JSON values */ }
          return "Use JSON variables within 65536 characters.";
        } },
        operationName: { type: "string", maxLength: 256, validator: (value) => name(value) || "Use a GraphQL operation name." }
      }, validResult, "POST"), scopes: permissions
    }
  },
  async exchange(address, options, { request }) {
    const result = await request(address, options);
    if (Array.isArray(result?.errors) && result.errors.length > 0) {
      // A mutation can have taken effect before partial errors arrive. Do not replay or expose provider text.
      throw new ConnectorError("connector_provider_failed", "Fabric could not complete the GraphQL document. Check its schema and permissions before retrying.", { statusCode: 502 });
    }
    return result;
  }
});

export { microsoftFabricProvider };
