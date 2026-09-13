import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { lightspeedDefinition } from "../shared/lightspeed.js";
import { jsonOperation } from "./jsonOperation.js";

const apiOrigin = (settings) => `https://${settings.domainPrefix}.retail.lightspeed.app`;
const versionNumber = (value) => Number.isSafeInteger(value) && value >= 0;
const identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);

function collection(resource) {
  const operation = jsonOperation((settings) => `${apiOrigin(settings)}/api/2026-07/${resource}`, {
    after: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
    before: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
    page_size: { type: "integer", min: 1, max: 100, defaultTo: 20 },
    ...(resource === "sales" ? {} : { deleted: { type: "boolean", defaultTo: false } })
  }, (result) => {
    if (!Array.isArray(result?.data) || !result.data.every((row) => identifier(row?.id) && versionNumber(row.version))) return false;
    // The customer reference includes a response without the optional envelope version.
    if (resource === "customers" && result.version === undefined) return true;
    const { min, max } = result.version || {};
    return result.data.length === 0 ? min === null && max === null :
      versionNumber(min) && versionNumber(max) && min <= max && result.data.every((row) => row.version >= min && row.version <= max);
  });
  return {
    ...operation, scopes: [`${resource}:read`],
    request(input, settings) {
      const request = operation.request(input, settings);
      const query = new URL(request.url).searchParams;
      if (query.has("after") && query.has("before") && Number(query.get("after")) >= Number(query.get("before"))) {
        throw new ConnectorError("connector_input_invalid", "The lower version must be below the upper version.", { statusCode: 422 });
      }
      return request;
    }
  };
}

const inventoryRead = jsonOperation(settings => `${apiOrigin(settings)}/api/2026-07/inventory`, {
  after: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
  before: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
  size: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
  include_deleted: { type: "boolean", defaultTo: false },
  sort_direction: { type: "string", enum: ["asc", "desc"], defaultTo: "asc" },
  product_id: { type: "string", validator: value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) || "Use a product UUID." },
  variants: { type: "boolean", defaultTo: false }
}, result => Array.isArray(result) && result.every(row => row && typeof row === "object" && !Array.isArray(row) && versionNumber(row.version)), "POST");

const lightspeedProvider = Object.freeze({
  ...lightspeedDefinition,
  oauth: (settings) => ({ issuer: "https://secure.retail.lightspeed.app", authorization_endpoint: "https://secure.retail.lightspeed.app/connect",
    token_endpoint: `${apiOrigin(settings)}/api/1.0/token` }),
  apiOrigins: (settings) => [apiOrigin(settings)], checkOperation: "products.list",
  async normalizeTokenResponse(response, { settings }) {
    if (response.ok) {
      let value;
      try { value = await response.clone().json(); } catch { /* reported below */ }
      if (value?.domain_prefix !== settings.domainPrefix || typeof value.refresh_token !== "string" || !value.refresh_token.trim() ||
        !Number.isSafeInteger(value.expires_in) || value.expires_in <= 0 ||
        typeof value.scope !== "string" || !/^[^\s]+(?: [^\s]+)*$/u.test(value.scope)) {
        throw new ConnectorError("connector_response_invalid", "Lightspeed returned an invalid token grant or a different store.", { statusCode: 502 });
      }
    }
    return response;
  },
  operations: { "products.list": collection("products"), "customers.list": collection("customers"), "outlets.list": collection("outlets"), "sales.list": collection("sales"),
    "inventory.list": { ...inventoryRead, scopes: ["inventory:read"], request(input, settings) {
      const request = inventoryRead.request(input, settings);
      const { after, before, variants, product_id } = request.body;
      if (after !== undefined && before !== undefined && after >= before || variants && !product_id)
        throw new ConnectorError("connector_input_invalid", "Use ordered inventory version bounds and a product ID when requesting variants.", { statusCode: 422 });
      return request;
    } }
  },
  async exchange(address, options, { request }) {
    const result = await request(address, options);
    const inventory = new URL(address).pathname.endsWith("/inventory");
    const limit = inventory ? options.body.size : Number(new URL(address).searchParams.get("page_size"));
    if ((inventory ? result?.length : result?.data?.length) > limit) {
      throw new ConnectorError("connector_response_invalid", "Lightspeed returned more records than requested.", { statusCode: 502 });
    }
    return result;
  }
});
export { lightspeedProvider };
