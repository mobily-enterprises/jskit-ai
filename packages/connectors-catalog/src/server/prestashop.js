import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { prestashopDefinition } from "../shared/prestashop.js";

const pageSchema = createSchema({
  offset: { type: "integer", min: 0, max: 1000000, defaultTo: 0 },
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  language: { type: "integer", min: 1, max: 2147483647 }
});

function listOperation(resource) {
  return {
    scopes: [],
    request(input, settings) {
      const values = validateSchemaPayload({ schema: pageSchema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`${settings.siteUrl.replace(/\/+$/u, "")}/api/${resource}`);
      url.searchParams.set("output_format", "JSON");
      url.searchParams.set("display", "full");
      url.searchParams.set("sort", "[id_ASC]");
      url.searchParams.set("limit", `${values.offset},${values.limit}`);
      if (values.language !== undefined) url.searchParams.set("language", String(values.language));
      return { method: "GET", url: url.href };
    },
    validateResult(result) {
      // PrestaShop's JSON writer emits [] when no resource nodes were rendered.
      if (Array.isArray(result)) return result.length === 0;
      return Boolean(result && !result.errors && Array.isArray(result[resource]) && result[resource].every((record) =>
        (typeof record?.id === "string" && /^[1-9]\d*$/u.test(record.id)) ||
        (Number.isSafeInteger(record?.id) && record.id > 0)));
    }
  };
}

const prestashopProvider = Object.freeze({
  ...prestashopDefinition,
  apiOrigins: (settings) => [new URL(settings.siteUrl).origin],
  apiKey: { headers: (key) => ({ Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` }) },
  checkOperation: "products.list",
  operations: { "products.list": listOperation("products"), "orders.list": listOperation("orders") }
});

export { prestashopProvider };
