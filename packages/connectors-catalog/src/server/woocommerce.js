import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { woocommerceDefinition } from "../shared/wordpress.js";
import { jsonOperation } from "./jsonOperation.js";

const baseUrl = (settings) => `${settings.siteUrl.replace(/\/+$/u, "")}/wp-json/wc/v3`;
const pagination = {
  page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
  per_page: { type: "integer", min: 1, max: 100, defaultTo: 10 },
  search: { type: "string", minLength: 1, maxLength: 500 }
};

const validRecord = {
  products: value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.name === "string",
  orders: value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.status === "string" && typeof value.total === "string",
  customers: value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.email === "string",
  coupons: value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.code === "string" && typeof value.amount === "string"
};
function readRecord(resource) {
  const schema = createSchema({ id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } });
  return {
    scopes: [],
    request(input, settings) {
      const { id } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `${baseUrl(settings)}/${resource}/${id}` };
    },
    validateResult: validRecord[resource]
  };
}

function deleteRecord(resource) {
  const permanentOnly = resource === "customers" || resource === "variations";
  const schema = createSchema({
    id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
    force: { type: "boolean", required: true },
    ...(resource === "variations" ? { product_id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } } : {}),
    ...(resource === "customers" ? { reassign: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER } } : {})
  });
  return {
    scopes: [],
    request(input, settings) {
      if (typeof input?.force !== "boolean") throw new ConnectorError("connector_input_invalid", "Choose explicitly whether to permanently delete.", { statusCode: 422 });
      const { id, force, product_id, reassign } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (permanentOnly && !force) throw new ConnectorError("connector_input_invalid", "This resource does not support trash; permanent deletion requires force=true.", { statusCode: 422 });
      if (reassign === id) throw new ConnectorError("connector_input_invalid", "Choose a different reassignment user.", { statusCode: 422 });
      const path = resource === "variations" ? `products/${product_id}/variations` : resource;
      const url = new URL(`${baseUrl(settings)}/${path}/${id}`);
      url.searchParams.set("force", String(force));
      if (reassign !== undefined) url.searchParams.set("reassign", String(reassign));
      return { method: "DELETE", url: url.href };
    },
    validateResult: resource === "variations" ? value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.price === "string" : validRecord[resource]
  };
}

function categoryOperation(action) {
  const writing = action === "create" || action === "update";
  const schema = createSchema({
    ...(action === "list" ? { ...pagination, hide_empty: { type: "boolean" }, parent: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER } } :
      action === "create" ? {} : { id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } }),
    ...(writing ? {
      name: { type: "string", required: action === "create", minLength: 1, maxLength: 200 },
      slug: { type: "string", maxLength: 200 }, description: { type: "string", maxLength: 10000 },
      parent: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
      display: { type: "string", enum: ["default", "products", "subcategories", "both"] },
      menu_order: { type: "integer", min: 0, max: 2147483647 },
      image: { type: "object", schema: createSchema({ id: { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER }, alt: { type: "string", maxLength: 1000 } }) }
    } : {}),
    ...(action === "delete" ? { force: { type: "boolean", required: true } } : {})
  });
  const valid = value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.name === "string" && Number.isSafeInteger(value.parent) && value.parent >= 0;
  return {
    scopes: [],
    request(input, settings) {
      const { id, ...fields } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (action === "delete" && input.force !== true) throw new ConnectorError("connector_input_invalid", "Category deletion is permanent and requires force=true.", { statusCode: 422 });
      if (id && fields.parent === id) throw new ConnectorError("connector_input_invalid", "A category cannot be its own parent.", { statusCode: 422 });
      const url = new URL(`${baseUrl(settings)}/products/categories${id ? `/${id}` : ""}`);
      if (writing) {
        if (!Object.keys(fields).length) throw new ConnectorError("connector_input_invalid", "Supply category changes.", { statusCode: 422 });
        return { method: action === "create" ? "POST" : "PUT", url: url.href, body: fields };
      }
      for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, String(value));
      return { method: action === "delete" ? "DELETE" : "GET", url: url.href };
    },
    validateResult: action === "list" ? value => Array.isArray(value) && value.length <= 100 && value.every(valid) : valid
  };
}

function couponWrite(update) {
  const money = { type: "string", maxLength: 40, validator: value => /^\d+(?:\.\d+)?$/u.test(value) || "Use a non-negative decimal amount string." };
  const ids = { type: "array", validator: values => values.length <= 1000 || "Use at most 1000 IDs.", items: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER } };
  const schema = createSchema({
    ...(update ? { id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } } : {}),
    code: { type: "string", required: !update, minLength: 1, maxLength: 200 },
    discount_type: { type: "string", enum: ["percent", "fixed_cart", "fixed_product"] },
    amount: money, minimum_amount: money, maximum_amount: money,
    description: { type: "string", maxLength: 10000 }, individual_use: { type: "boolean" },
    product_ids: ids, excluded_product_ids: ids, product_categories: ids, excluded_product_categories: ids,
    usage_limit: { type: "integer", min: 0, max: 2147483647 },
    usage_limit_per_user: { type: "integer", min: 0, max: 2147483647 },
    limit_usage_to_x_items: { type: "integer", min: 0, max: 2147483647 },
    free_shipping: { type: "boolean" }, exclude_sale_items: { type: "boolean" },
    email_restrictions: { type: "array", validator: values => values.length <= 1000 || "Use at most 1000 email restrictions.", items: { type: "string", minLength: 1, maxLength: 320 } }
  });
  return {
    scopes: [],
    request(input, settings) {
      const { id, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Supply coupon changes.", { statusCode: 422 });
      if (body.discount_type === "percent" && body.amount !== undefined && Number(body.amount) > 100) {
        throw new ConnectorError("connector_input_invalid", "Percentage discounts cannot exceed 100.", { statusCode: 422 });
      }
      return { method: update ? "PUT" : "POST", url: `${baseUrl(settings)}/coupons${update ? `/${id}` : ""}`, body };
    }, validateResult: validRecord.coupons
  };
}

function productWrite(update) {
  const price = { type: "string", maxLength: 40, validator: value => /^(?:\d+(?:\.\d+)?)?$/u.test(value) || "Use a non-negative decimal string, or empty to clear." };
  const schema = createSchema({
    ...(update ? { id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } } : {}),
    name: { type: "string", required: !update, minLength: 1, maxLength: 1000 },
    status: { type: "string", required: !update, enum: ["draft", "pending", "private", "publish"] },
    type: { type: "string", enum: ["simple", "variable"] },
    description: { type: "string", maxLength: 100000 }, short_description: { type: "string", maxLength: 10000 },
    sku: { type: "string", maxLength: 200 }, regular_price: price, sale_price: price,
    manage_stock: { type: "boolean" }, stock_quantity: { type: "integer", min: -2147483648, max: 2147483647 },
    stock_status: { type: "string", enum: ["instock", "outofstock", "onbackorder"] },
    backorders: { type: "string", enum: ["no", "notify", "yes"] },
    virtual: { type: "boolean" }, featured: { type: "boolean" }, sold_individually: { type: "boolean" },
    attributes: { type: "array", validator: values => values.length <= 100 || "Use at most 100 attributes.",
      items: { type: "object", schema: createSchema({
        name: { type: "string", required: true, minLength: 1, maxLength: 200 },
        visible: { type: "boolean" }, variation: { type: "boolean" },
        options: { type: "array", required: true, validator: values => values.length <= 100 || "Use at most 100 options.", items: { type: "string", minLength: 1, maxLength: 200 } }
      }) } },
    categories: { type: "array", validator: values => values.length <= 100 || "Use at most 100 categories.",
      items: { type: "object", schema: createSchema({ id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } }) } },
    images: { type: "array", validator: values => values.length <= 100 || "Use at most 100 images.",
      items: { type: "object", schema: createSchema({ id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER }, alt: { type: "string", maxLength: 1000 } }) } }
  });
  return {
    scopes: [],
    request(input, settings) {
      for (const field of ["regular_price", "sale_price"]) {
        if (input?.[field] !== undefined && typeof input[field] !== "string") {
          throw new ConnectorError("connector_input_invalid", "Product prices must be decimal strings.", { statusCode: 422 });
        }
      }
      const { id, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Supply product changes.", { statusCode: 422 });
      return { method: update ? "PUT" : "POST", url: `${baseUrl(settings)}/products${update ? `/${id}` : ""}`, body };
    }, validateResult: validRecord.products
  };
}

function customerWrite(update) {
  const text = { type: "string", maxLength: 1000 };
  const address = {
    first_name: text, last_name: text, company: text, address_1: text, address_2: text,
    city: text, state: text, postcode: text, country: { type: "string", maxLength: 2 }
  };
  const schema = createSchema({
    ...(update ? { id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } } : {
      username: { type: "string", minLength: 1, maxLength: 60 }
    }),
    email: { type: "string", required: !update, minLength: 1, maxLength: 320 },
    first_name: text, last_name: text,
    billing: { type: "object", schema: createSchema({ ...address, email: text, phone: text }) },
    shipping: { type: "object", schema: createSchema(address) }
  });
  return {
    scopes: [],
    request(input, settings) {
      const { id, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(body).length || [body.billing, body.shipping].some(value => value && !Object.keys(value).length)) {
        throw new ConnectorError("connector_input_invalid", "Supply customer changes and non-empty address objects.", { statusCode: 422 });
      }
      return { method: update ? "PUT" : "POST", url: `${baseUrl(settings)}/customers${update ? `/${id}` : ""}`, body };
    }, validateResult: validRecord.customers
  };
}

function variationOperation(action) {
  const writing = action === "create" || action === "update";
  const schema = createSchema({
    product_id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
    ...(action === "create" ? {} : action === "list" ? pagination : { id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } }),
    ...(writing ? {
      regular_price: { type: "string", maxLength: 40, validator: value => /^(?:\d+(?:\.\d+)?)?$/u.test(value) || "Use a decimal string or empty to clear." },
      sale_price: { type: "string", maxLength: 40, validator: value => /^(?:\d+(?:\.\d+)?)?$/u.test(value) || "Use a decimal string or empty to clear." },
      sku: { type: "string", maxLength: 200 },
      status: { type: "string", required: action === "create", enum: ["draft", "pending", "private", "publish"] },
      attributes: { type: "array", required: action === "create", validator: values => values.length > 0 && values.length <= 100 || "Choose 1–100 attributes.",
        items: { type: "object", schema: createSchema({ name: { type: "string", required: true, minLength: 1, maxLength: 200 }, option: { type: "string", required: true, minLength: 1, maxLength: 200 } }) } },
      manage_stock: { type: "boolean" },
      stock_quantity: { type: "integer", min: -2147483648, max: 2147483647 },
      stock_status: { type: "string", enum: ["instock", "outofstock", "onbackorder"] },
      backorders: { type: "string", enum: ["no", "notify", "yes"] }
    } : {})
  });
  const valid = value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.price === "string" && Array.isArray(value.attributes);
  return {
    scopes: [],
    request(input, settings) {
      for (const field of ["regular_price", "sale_price"]) {
        if (input?.[field] !== undefined && typeof input[field] !== "string") throw new ConnectorError("connector_input_invalid", "Variation prices must be decimal strings.", { statusCode: 422 });
      }
      const { product_id, id, ...fields } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`${baseUrl(settings)}/products/${product_id}/variations${id ? `/${id}` : ""}`);
      if (writing) {
        if (!Object.keys(fields).length) throw new ConnectorError("connector_input_invalid", "Supply variation changes.", { statusCode: 422 });
        return { method: action === "create" ? "POST" : "PUT", url: url.href, body: fields };
      }
      for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, String(value));
      return { method: "GET", url: url.href };
    },
    validateResult: action === "list" ? value => Array.isArray(value) && value.length <= 100 && value.every(valid) : valid
  };
}

function refundOperation(action) {
  const amount = { type: "string", required: true, maxLength: 40, validator: value => /^\d+(?:\.\d+)?$/u.test(value) || "Use a non-negative decimal string." };
  const schema = createSchema({
    order_id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
    ...(action === "get" ? { id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } } : {}),
    ...(action === "list" ? { page: pagination.page, per_page: pagination.per_page } : {}),
    ...(action === "create" ? {
      amount, reason: { type: "string", required: true, minLength: 1, maxLength: 1000 },
      api_refund: { type: "boolean", required: true }, api_restock: { type: "boolean", required: true },
      line_items: { type: "array", validator: values => values.length <= 100 || "Use at most 100 refund lines.", items: { type: "object", schema: createSchema({
        id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
        quantity: { type: "integer", required: true, min: 0, max: 100000 }, refund_total: amount
      }) } }
    } : {})
  });
  const valid = value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.amount === "string" && typeof value.refunded_payment === "boolean";
  return {
    scopes: [],
    request(input, settings) {
      if (action === "create" && (typeof input?.amount !== "string" || typeof input.api_refund !== "boolean" || typeof input.api_restock !== "boolean" ||
          input.line_items?.some?.(line => typeof line?.refund_total !== "string"))) {
        throw new ConnectorError("connector_input_invalid", "Choose explicit refund/restock flags and decimal-string amounts.", { statusCode: 422 });
      }
      const { order_id, id, ...fields } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (action === "create" && fields.api_restock && !fields.line_items?.some(line => line.quantity > 0)) {
        throw new ConnectorError("connector_input_invalid", "Restocking requires selected order lines and positive quantities.", { statusCode: 422 });
      }
      const url = new URL(`${baseUrl(settings)}/orders/${order_id}/refunds${id ? `/${id}` : ""}`);
      if (action === "create") return { method: "POST", url: url.href, body: fields };
      for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, String(value));
      return { method: "GET", url: url.href };
    },
    validateResult: action === "list" ? value => Array.isArray(value) && value.length <= 100 && value.every(valid) : valid
  };
}

function reportOperation(report) {
  const dated = report === "sales" || report === "top_sellers";
  const date = { type: "string", validator: value => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value || "Use a valid YYYY-MM-DD date." };
  const schema = createSchema(dated ? { period: { type: "string", enum: ["week", "month", "last_month", "year"] }, date_min: date, date_max: date } : {});
  return {
    scopes: [],
    request(input, settings) {
      const fields = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if ((fields.date_min === undefined) !== (fields.date_max === undefined) ||
          (fields.period && fields.date_min) || (fields.date_min && fields.date_min > fields.date_max)) {
        throw new ConnectorError("connector_input_invalid", "Choose a period or a complete ascending date range.", { statusCode: 422 });
      }
      const url = new URL(`${baseUrl(settings)}/reports/${report}`);
      for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
      return { method: "GET", url: url.href };
    },
    validateResult(value) {
      if (!Array.isArray(value)) return false;
      if (report === "sales") return value.length === 1 && typeof value[0]?.total_sales === "string" && typeof value[0]?.net_sales === "string" && Number.isSafeInteger(value[0]?.total_orders) && value[0]?.totals !== null && typeof value[0]?.totals === "object";
      if (report === "top_sellers") return value.every(row => Number.isSafeInteger(row?.product_id) && row.product_id > 0 && typeof row.title === "string" && Number.isSafeInteger(row.quantity));
      return value.every(row => typeof row?.slug === "string" && typeof row.name === "string" && Number.isSafeInteger(row.total) && row.total >= 0);
    }
  };
}

const orderAddressFields = Object.fromEntries(
  ["first_name", "last_name", "company", "address_1", "address_2", "city", "state", "postcode", "country"].map(name => [name, { type: "string", maxLength: 1000 }])
);
const orderCreateSchema = createSchema({
  customer_id: { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  status: { type: "string", required: true, enum: ["pending", "on-hold"] },
  customer_note: { type: "string", maxLength: 10000 },
  billing: { type: "object", schema: createSchema({ ...orderAddressFields, email: { type: "string", maxLength: 320 }, phone: { type: "string", maxLength: 100 } }) },
  shipping: { type: "object", schema: createSchema(orderAddressFields) },
  line_items: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 100 || "Choose 1–100 order items.",
    items: { type: "object", schema: createSchema({
      product_id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
      variation_id: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER },
      quantity: { type: "integer", required: true, min: 1, max: 100000 }
    }) } },
  coupon_lines: { type: "array", validator: values => values.length <= 100 || "Use at most 100 coupons.",
    items: { type: "object", schema: createSchema({ code: { type: "string", required: true, minLength: 1, maxLength: 200 } }) } }
});

const orderUpdateSchema = createSchema({
  id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  status: { type: "string", enum: ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"] },
  customer_note: { type: "string", maxLength: 10000 }
});

const woocommerceProvider = Object.freeze({
  ...woocommerceDefinition,
  apiOrigins: (settings) => [new URL(settings.siteUrl).origin],
  apiKey: { headers: (secret, settings) => ({ Authorization: `Basic ${Buffer.from(`${settings.consumerKey}:${secret}`).toString("base64")}` }) },
  checkOperation: "products.list",
  async exchange(address, options, { request }) {
    const result = await request(address, options);
    const match = /\/wp-json\/wc\/v3\/(?:products|orders|customers|coupons)\/(\d+)$/u.exec(new URL(address).pathname);
    if (match && result?.id !== Number(match[1])) throw new ConnectorError("connector_response_invalid", "WooCommerce returned a different record.", { statusCode: 502 });
    const variation = /\/wp-json\/wc\/v3\/products\/\d+\/variations\/(\d+)$/u.exec(new URL(address).pathname);
    if (variation && result?.id !== Number(variation[1])) throw new ConnectorError("connector_response_invalid", "WooCommerce returned a different variation.", { statusCode: 502 });
    const category = /\/wp-json\/wc\/v3\/products\/categories\/(\d+)$/u.exec(new URL(address).pathname);
    if (category && result?.id !== Number(category[1])) throw new ConnectorError("connector_response_invalid", "WooCommerce returned a different category.", { statusCode: 502 });
    const refund = /\/wp-json\/wc\/v3\/orders\/\d+\/refunds\/(\d+)$/u.exec(new URL(address).pathname);
    if (refund && result?.id !== Number(refund[1])) throw new ConnectorError("connector_response_invalid", "WooCommerce returned a different refund.", { statusCode: 502 });
    return result;
  },
  operations: {
    "refunds.list": refundOperation("list"),
    "refunds.get": refundOperation("get"),
    "refunds.create": refundOperation("create"),
    "reports.sales": reportOperation("sales"),
    "reports.topSellers": reportOperation("top_sellers"),
    "reports.orders": reportOperation("orders/totals"),
    "reports.products": reportOperation("products/totals"),
    "reports.customers": reportOperation("customers/totals"),
    "reports.coupons": reportOperation("coupons/totals"),
    "categories.list": categoryOperation("list"),
    "categories.get": categoryOperation("get"),
    "categories.create": categoryOperation("create"),
    "categories.update": categoryOperation("update"),
    "categories.delete": categoryOperation("delete"),
    "variations.create": variationOperation("create"),
    "variations.list": variationOperation("list"),
    "variations.delete": deleteRecord("variations"),
    "variations.get": variationOperation("get"),
    "variations.update": variationOperation("update"),
    "products.delete": deleteRecord("products"),
    "products.get": readRecord("products"),
    "products.create": productWrite(false),
    "products.update": productWrite(true),
    "orders.delete": deleteRecord("orders"),
    "orders.get": readRecord("orders"),
    "orders.create": {
      scopes: [],
      request(input, settings) {
        const body = validateSchemaPayload({ schema: orderCreateSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: `${baseUrl(settings)}/orders`, body };
      }, validateResult: validRecord.orders
    },
    "orders.update": {
      scopes: [],
      request(input, settings) {
        const { id, ...body } = validateSchemaPayload({ schema: orderUpdateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Supply order changes.", { statusCode: 422 });
        return { method: "PUT", url: `${baseUrl(settings)}/orders/${id}`, body };
      }, validateResult: validRecord.orders
    },
    "customers.delete": deleteRecord("customers"),
    "customers.get": readRecord("customers"),
    "customers.create": customerWrite(false),
    "customers.update": customerWrite(true),
    "coupons.delete": deleteRecord("coupons"),
    "coupons.get": readRecord("coupons"),
    "coupons.create": couponWrite(false),
    "coupons.update": couponWrite(true),
    "customers.list": jsonOperation(settings => `${baseUrl(settings)}/customers`, {
      ...pagination, email: { type: "string", minLength: 1, maxLength: 320 }
    }, result => Array.isArray(result) && result.length <= 100 && result.every(validRecord.customers)),
    "coupons.list": jsonOperation(settings => `${baseUrl(settings)}/coupons`, {
      ...pagination, code: { type: "string", minLength: 1, maxLength: 500 }
    }, result => Array.isArray(result) && result.length <= 100 && result.every(validRecord.coupons)),
    "products.list": jsonOperation((settings) => `${baseUrl(settings)}/products`, {
      ...pagination,
      status: { type: "string", enum: ["any", "draft", "pending", "private", "publish"], defaultTo: "any" },
      sku: { type: "string", minLength: 1, maxLength: 500 },
      stock_status: { type: "string", enum: ["instock", "outofstock", "onbackorder"] }
    }, (result) => Array.isArray(result) && result.every((product) => Number.isInteger(product?.id) && product.id > 0 && typeof product.name === "string")),
    "orders.list": jsonOperation((settings) => `${baseUrl(settings)}/orders`, {
      ...pagination,
      status: { type: "string", enum: ["any", "pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash"], defaultTo: "any" },
      customer: { type: "integer", min: 0 }
    }, (result) => Array.isArray(result) && result.every((order) => Number.isInteger(order?.id) && order.id > 0 && typeof order.status === "string" && typeof order.total === "string"))
  }
});

// Verify before parsing or processing. The application owns routing and replay protection.
function verifyWooCommerceWebhook({ rawBody, signature, secret } = {}) {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > 2 * 1024 * 1024 ||
      typeof secret !== "string" || !secret || typeof signature !== "string" ||
      !/^[A-Za-z0-9+/]{43}=$/u.test(signature)) {
    throw new ConnectorError("connector_webhook_invalid", "Invalid WooCommerce webhook signature inputs.", { statusCode: 401 });
  }
  const supplied = Buffer.from(signature, "base64");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (supplied.toString("base64") !== signature || !timingSafeEqual(expected, supplied)) {
    throw new ConnectorError("connector_webhook_invalid", "Invalid WooCommerce webhook signature.", { statusCode: 401 });
  }
  return true;
}

export { woocommerceProvider, verifyWooCommerceWebhook };
