import { createSchema } from "json-rest-schema";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { shopifyDefinition } from "../shared/shopify.js";
import { graphqlOperation } from "./graphqlOperation.js";

const origin = (settings) => `https://${settings.shopDomain}`;
const endpoint = (settings) => `${origin(settings)}/admin/api/2026-07/graphql.json`;
const productId = (value) => typeof value === "string" && /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/u.test(value);
const idField = { type: "string", required: true, noTrim: true, maxLength: 100, validator: (value) => productId(value) || "Use a Shopify Product GID." };
const productFields = {
  title: { type: "string", minLength: 1, maxLength: 255, noTrim: true },
  descriptionHtml: { type: "string", maxLength: 65536, noTrim: true },
  vendor: { type: "string", maxLength: 255, noTrim: true },
  productType: { type: "string", maxLength: 255, noTrim: true },
  status: { type: "string", enum: ["ACTIVE", "ARCHIVED", "DRAFT"] },
  tags: { type: "array", validator: (value) => value.length <= 250 || "Use at most 250 tags.",
    items: { type: "string", minLength: 1, maxLength: 255, noTrim: true } }
};
const productSelection = "id title handle status";
const validProduct = (product) => productId(product?.id) && typeof product.title === "string" && typeof product.handle === "string" &&
  ["ACTIVE", "ARCHIVED", "DRAFT"].includes(product.status);
const emptyUserErrors = (payload) => Array.isArray(payload?.userErrors) && payload.userErrors.length === 0;

function productMutation(name, fields) {
  const operation = graphqlOperation(endpoint,
    `mutation ConnectorProduct${name}($product: Product${name}Input!) { product${name}(product: $product) { product { ${productSelection} } userErrors { field message } } }`,
    { product: { type: "object", required: true, schema: createSchema(fields) } },
    (data) => emptyUserErrors(data?.[`product${name}`]) && validProduct(data[`product${name}`].product));
  return { ...operation, scopes: ["write_products"], request(input, settings) {
    const request = operation.request(input, settings);
    if (name === "Update" && Object.keys(request.body.variables.product).length === 1) {
      throw new ConnectorError("connector_input_invalid", "Select at least one product detail to update.", { statusCode: 422 });
    }
    return request;
  } };
}

const shopifyProvider = Object.freeze({
  ...shopifyDefinition,
  oauth: (settings) => ({ issuer: origin(settings), token_endpoint: `${origin(settings)}/admin/oauth/access_token` }),
  scopeSeparator: ",", apiOrigins: (settings) => [origin(settings)],
  apiKey: { headers: (token) => ({ "X-Shopify-Access-Token": token }) },
  checkOperation: "products.list",
  async normalizeTokenResponse(response) {
    if (!response.ok) return response;
    let token;
    try { token = await response.clone().json(); } catch { /* reported below */ }
    if (typeof token?.access_token !== "string" || !token.access_token.trim() ||
      !Number.isSafeInteger(token.expires_in) || token.expires_in <= 0 ||
      typeof token.scope !== "string" || !/^[a-z_]+(?:,[a-z_]+)*$/u.test(token.scope)) {
      throw new ConnectorError("connector_response_invalid", "Shopify returned an invalid token grant.", { statusCode: 502 });
    }
    // Shopify's documented client-credentials response omits the standard token_type.
    return Response.json({ ...token, token_type: token.token_type ?? "Bearer" });
  },
  operations: {
    "products.list": { ...graphqlOperation(endpoint,
      `query ConnectorProducts($first: Int!, $after: String, $query: String) { products(first: $first, after: $after, query: $query) { nodes { ${productSelection} } pageInfo { hasNextPage endCursor } } }`,
      { first: { type: "integer", min: 1, max: 100, defaultTo: 20 },
        after: { type: "string", minLength: 1, maxLength: 4096, noTrim: true },
        query: { type: "string", minLength: 1, maxLength: 1024, noTrim: true } },
      (data) => Array.isArray(data?.products?.nodes) && data.products.nodes.length <= 100 && data.products.nodes.every(validProduct) &&
        typeof data.products.pageInfo?.hasNextPage === "boolean" &&
        (data.products.pageInfo.endCursor === null || (typeof data.products.pageInfo.endCursor === "string" && data.products.pageInfo.endCursor.length > 0)) &&
        (!data.products.pageInfo.hasNextPage || typeof data.products.pageInfo.endCursor === "string")),
      scopes: ["read_products", "write_products"] },
    "products.create": productMutation("Create", { ...productFields, title: { ...productFields.title, required: true }, status: { ...productFields.status, defaultTo: "DRAFT" } }),
    "products.update": productMutation("Update", { id: idField, ...productFields }),
    "products.delete": { ...graphqlOperation(endpoint,
      "mutation ConnectorProductDelete($input: ProductDeleteInput!) { productDelete(input: $input, synchronous: true) { deletedProductId userErrors { field message } } }",
      { input: { type: "object", required: true, schema: createSchema({ id: idField }) } },
      (data) => emptyUserErrors(data?.productDelete) && productId(data.productDelete.deletedProductId)), scopes: ["write_products"] }
  },
  async exchange(address, options, { request }) {
    const headers = { ...options.headers };
    if (headers.Authorization) {
      headers["X-Shopify-Access-Token"] = headers.Authorization.slice("Bearer ".length);
      delete headers.Authorization;
    }
    const result = await request(address, { ...options, headers });
    if (Array.isArray(result?.errors) && result.errors.length) {
      const codes = result.errors.map((error) => error?.extensions?.code);
      if (codes.includes("THROTTLED")) throw new ConnectorError("connector_rate_limited", "Shopify's request limit was reached.", { statusCode: 429 });
      if (codes.includes("ACCESS_DENIED")) throw new ConnectorError("connector_permission_denied", "Shopify denied this operation.", { statusCode: 403 });
    }
    for (const name of ["productCreate", "productUpdate", "productDelete"]) {
      const payload = result?.data?.[name];
      if (Array.isArray(payload?.userErrors) && payload.userErrors.length) {
        throw new ConnectorError("connector_operation_rejected", "Shopify rejected the product change. Check the product values and permissions before retrying.", { statusCode: 422 });
      }
    }
    if (result?.data?.products?.nodes?.length > options.body.variables.first) {
      throw new ConnectorError("connector_response_invalid", "Shopify returned more products than requested.", { statusCode: 502 });
    }
    return result;
  }
});

export { shopifyProvider };
