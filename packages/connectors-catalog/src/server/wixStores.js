import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { requestPath, sameRecord, cursor, contactIdField, nativeJsonObjectField } from "./wixValues.js";
import { isUuid } from "../shared/uuid.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// Wix eCommerce and Stores operations: carts, products, catalog version, orders, fulfillments and business locations.

function productReadOperation(version, action) {
  const schema = createSchema(action === "get" ? {
    productId: { type: "string", required: true, validator: value => isUuid(value) || "Use the Wix product ID." }
  } : {
    limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
    ...(version === 1 ? { offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 }, includeVariants: { type: "boolean", defaultTo: false } } :
      { cursor: { type: "string", validator: value => cursor(value) || "Use the returned product cursor." } })
  });
  const validProduct = value => isUuid(value?.id) && typeof value.name === "string" && value.name.length > 0;
  return {
    scopes: [],
    request(input) {
      const value = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const base = version === 1 ? "https://www.wixapis.com/stores-reader/v1/products" : "https://www.wixapis.com/stores/v3/products";
      if (action === "get") return { method: "GET", url: `${base}/${value.productId}` };
      const { includeVariants, ...paging } = value;
      return { method: "POST", url: `${base}/query`,
        body: version === 1 ? { query: { paging }, includeVariants } : { query: { cursorPaging: paging } } };
    },
    validateResult: (value, request) => action === "get" ? validProduct(value?.product) && sameRecord(value.product.id === requestPath(request, -1), "Wix returned a different product.", { messageCode: "connectors.wix.returnedDifferentProduct" }) : Array.isArray(value?.products) && value.products.length <= 100 && value.products.every(validProduct) &&
      (version === 1 ? (value.totalResults === undefined || Number.isSafeInteger(value.totalResults) && value.totalResults >= 0) &&
        (value.metadata === undefined || isRecord(value.metadata) &&
          ["items", "offset"].every(key => value.metadata[key] === undefined || Number.isSafeInteger(value.metadata[key]) && value.metadata[key] >= 0)) :
        (value.pagingMetadata === undefined || isRecord(value.pagingMetadata) &&
          (value.pagingMetadata.cursors === undefined || isRecord(value.pagingMetadata.cursors) &&
            ["next", "prev"].every(key => value.pagingMetadata.cursors[key] === undefined || cursor(value.pagingMetadata.cursors[key])))))
  };
}
function locationWriteOperation(action) {
  const schema = createSchema({
    ...(action === "update" ? {
      locationId: contactIdField,
      revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current location revision string." }
    } : {}),
    name: { type: "string", required: true, minLength: 1, maxLength: 150 },
    timeZone: { type: "string", required: true, maxLength: 150, validator: value => {
      try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Use an IANA time zone."; }
    } },
    description: { type: "string", maxLength: 500 }, email: { type: "string", maxLength: 320 },
    phone: { type: "string", maxLength: 100 }, fax: { type: "string", maxLength: 100 },
    status: { type: "string", enum: ["ACTIVE"] },
    locationTypes: { type: "array", validator: values => values.length <= 10 || "Use at most 10 location types.", items: { type: "string", enum: ["UNKNOWN", "BRANCH", "OFFICES", "RECEPTION", "HEADQUARTERS", "INVENTORY"] } },
    businessSchedule: nativeJsonObjectField, extendedFields: nativeJsonObjectField,
    address: { type: "object", required: true, schema: createSchema({
      country: { type: "string", validator: value => /^[A-Z]{2}$/u.test(value) || "Use a two-letter country code." },
      subdivision: { type: "string", maxLength: 100 }, city: { type: "string", maxLength: 1000 }, postalCode: { type: "string", maxLength: 20 },
      formattedAddress: { type: "string", maxLength: 4000 }, hint: { type: "string", maxLength: 500 },
      streetAddress: { type: "object", schema: createSchema({ number: { type: "string", maxLength: 100 }, name: { type: "string", maxLength: 1000 }, apt: { type: "string", maxLength: 100 } }) },
      geocode: { type: "object", schema: createSchema({ latitude: { type: "number", required: true, min: -90, max: 90 }, longitude: { type: "number", required: true, min: -180, max: 180 } }) }
    }) }
  });
  return {
    scopes: [],
    request(input) {
      const { locationId, ...location } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(location.address).length) throw new ConnectorError("connector_input_invalid", "Provide the location address.", { statusCode: 422, messageCode: "connectors.wix.provideLocationAddress" });
      if (location.businessSchedule && (["periods", "specialHourPeriod"].some(key => location.businessSchedule[key] !== undefined &&
          (!Array.isArray(location.businessSchedule[key]) || location.businessSchedule[key].length > 100)) ||
          Object.keys(location.businessSchedule).some(key => !["periods", "specialHourPeriod"].includes(key)))) {
        throw new ConnectorError("connector_input_invalid", "Use native businessSchedule periods and specialHourPeriod arrays with at most 100 entries each.", { statusCode: 422, messageCode: "connectors.wix.businessScheduleLimits" });
      }
      return { method: action === "create" ? "POST" : "PUT", url: `https://www.wixapis.com/locations/v1/locations${locationId ? `/${locationId}` : ""}`,
        body: { location: { ...(locationId ? { id: locationId } : {}), ...location } } };
    },
    validateResult: (value, request) => validLocation(value?.location) && typeof value.location.revision === "string" && /^\d{1,19}$/u.test(value.location.revision) &&
      (action === "create" || sameRecord(value.location.id === requestPath(request, -1), "Wix returned a different business location.", { messageCode: "connectors.wix.returnedDifferentBusinessLocation" }))
  };
}
function locationActionOperation(action) {
  const schema = createSchema({ locationId: contactIdField });
  return {
    scopes: [],
    request(input) {
      const { locationId } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: `https://www.wixapis.com/locations/v1/locations/${locationId}/${action}`,
        body: {} };
    },
    validateResult: (value, request) => validLocation(value?.location) && sameRecord(value.location.id === requestPath(request, -2), "Wix returned a different business location.", { messageCode: "connectors.wix.returnedDifferentBusinessLocation" }) &&
      (action === "archive" ? value.location.archived === true : value.location.default === true)
  };
}
const locationQuerySchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }, offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 },
  archived: { type: "boolean", defaultTo: false }
});
const locationGetSchema = createSchema({ locationId: { type: "string", required: true, validator: value => isUuid(value) || "Use the returned location ID." } });
const validLocation = value => isUuid(value?.id) && typeof value.name === "string" &&
  (value.timeZone === undefined || typeof value.timeZone === "string") && (value.archived === undefined || typeof value.archived === "boolean");
const productV1UpdateSchema = createSchema({
  productId: { type: "string", required: true, validator: value => isUuid(value) || "Use the Wix product ID." },
  name: { type: "string", minLength: 1, maxLength: 80 }, visible: { type: "boolean" },
  price: { type: "none", validator: value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 999999999.99 || "Use a numeric Wix base price from 0 to 999999999.99." }
});
const productV3UpdateSchema = createSchema({
  productId: { type: "string", required: true, validator: value => isUuid(value) || "Use the Wix product ID." },
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current product revision string." },
  name: { type: "string", minLength: 1, maxLength: 80 },
  visible: { type: "boolean" }
});
const catalogVersionSchema = createSchema({});
const orderSearchSchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  cursor: { type: "string", validator: value => cursor(value) || "Use the returned order cursor." },
  status: { type: "string", minLength: 1, maxLength: 100 },
  contactId: { type: "string", validator: value => isUuid(value) || "Use the buyer's contact ID." }
});
const orderIdSchema = createSchema({ orderId: { type: "string", required: true, minLength: 1, maxLength: 100, validator: value => !/[\p{Cc}]/u.test(value) && ![".", ".."].includes(value) || "Use the returned order ID." } });
const cartCreateSchema = createSchema({
  note: { type: "string", maxLength: 1000 },
  catalogItems: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 300 || "Select 1–300 catalogue items.",
    items: { type: "object", schema: createSchema({
      quantity: { type: "integer", required: true, min: 1, max: 100000 },
      catalogReference: { type: "object", required: true, schema: createSchema({
        appId: { type: "string", required: true, validator: value => isUuid(value) || "Use the catalogue app ID." },
        catalogItemId: { type: "string", required: true, minLength: 1, maxLength: 36, validator: value => !/[\p{Cc}]/u.test(value) || "Use the selected catalogue item ID." },
        options: nativeJsonObjectField
      }) }
    }) } }
});
const cartIdSchema = createSchema({ cartId: { type: "string", required: true, validator: value => isUuid(value) || "Use the cart ID returned by Wix." } });
const validOrder = value => typeof value?.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
  typeof value.status === "string" && value.status.length > 0 && (value.currency === undefined || typeof value.currency === "string") &&
  (value.lineItems === undefined || Array.isArray(value.lineItems));
function fulfillmentWriteOperation(update) {
  const trackingSchema = createSchema({
    trackingNumber: { type: "string", minLength: 1, maxLength: 100 },
    shippingProvider: { type: "string", minLength: 1, maxLength: 100 },
    trackingLink: { type: "string", minLength: 1, maxLength: 2048, validator: value => {
      try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password || "Use a public tracking URL."; }
      catch { return "Use a public tracking URL."; }
    } }
  });
  const schema = createSchema({
    orderId: { type: "string", required: true, minLength: 1, maxLength: 100, validator: value => !/[\p{Cc}]/u.test(value) && ![".", ".."].includes(value) || "Use the returned order ID." },
    ...(update ? { fulfillmentId: contactIdField } : {}),
    lineItems: { type: "array", required: !update, validator: values => values.length > 0 && values.length <= 300 && new Set(values.map(item => item?.id)).size === values.length || "Select 1–300 distinct order line items.",
      items: { type: "object", schema: createSchema({ id: contactIdField, quantity: { type: "integer", required: true, min: 1, max: 100000 } }) } },
    trackingInfo: { type: "object", schema: trackingSchema },
    status: { type: "string", enum: ["Pending", "Accepted", "Ready", "In_Delivery", "Fulfilled"] },
    completed: { type: "boolean" }
  });
  return {
    scopes: [],
    request(input) {
      const { orderId, fulfillmentId, ...fulfillment } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(fulfillment).length || fulfillment.trackingInfo && !Object.keys(fulfillment.trackingInfo).length) {
        throw new ConnectorError("connector_input_invalid", "Supply the fulfillment properties to write.", { statusCode: 422, messageCode: "connectors.wix.supplyFulfillmentPropertiesWrite" });
      }
      const tracking = fulfillment.trackingInfo;
      if (!update && tracking && (!tracking.trackingNumber || !tracking.shippingProvider ||
          !["fedex", "ups", "usps", "dhl", "canadaPost"].includes(tracking.shippingProvider) && !tracking.trackingLink)) {
        throw new ConnectorError("connector_input_invalid", "Supply tracking number and provider; custom carriers also require a tracking URL.", { statusCode: 422, messageCode: "connectors.wix.supplyTrackingNumberProviderCustom" });
      }
      return { method: update ? "PATCH" : "POST", url: update
        ? `https://www.wixapis.com/ecom/v1/fulfillments/${fulfillmentId}/orders/${encodeURIComponent(orderId)}`
        : `https://www.wixapis.com/ecom/v1/fulfillments/orders/${encodeURIComponent(orderId)}/create-fulfillment`,
        body: { fulfillment } };
    },
    validateResult: (value, request) => typeof value?.orderWithFulfillments?.orderId === "string" &&
      sameRecord(value.orderWithFulfillments.orderId === requestPath(request, update ? -1 : -2), "Wix returned fulfillments for a different order.", { messageCode: "connectors.wix.returnedFulfillmentsDifferentOrder" }) &&
      Array.isArray(value.orderWithFulfillments.fulfillments) &&
      value.orderWithFulfillments.fulfillments.every(item => isUuid(item?.id) && Array.isArray(item.lineItems) && item.lineItems.length <= 300 &&
        item.lineItems.every(line => isUuid(line?.id) && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 100000)) &&
      (update ? sameRecord(value.orderWithFulfillments.fulfillments.some(item => item.id === requestPath(request, -3)),
        "Wix did not return the updated fulfillment. Inspect the order before retrying.", { messageCode: "connectors.wix.didNotReturnUpdatedFulfillment" }) :
        isUuid(value.fulfillmentId) && value.orderWithFulfillments.fulfillments.some(item => item.id === value.fulfillmentId))
  };
}
const wixStoreOperations = {
  "carts.create": {
    scopes: [],
    request(input) {
      const { note, catalogItems } = validateSchemaPayload({ schema: cartCreateSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: "https://www.wixapis.com/ecom/v2/carts",
        body: { cart: { source: { channelType: "WEB" }, ...(note === undefined ? {} : { note }) }, catalogItems } };
    },
    validateResult: value => isUuid(value?.cart?.id) && Array.isArray(value.cart.lineItems) && value.cart.lineItems.length <= 300 &&
      value.cart.lineItems.every(item => isUuid(item?.id))
  },
  "carts.getCheckoutUrl": {
    scopes: [],
    request(input) {
      const { cartId } = validateSchemaPayload({ schema: cartIdSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: `https://www.wixapis.com/ecom/v2/carts/${cartId}/get-checkout-url`, body: {} };
    },
    validateResult(value) {
      if (typeof value?.checkoutUrl !== "string" || value.checkoutUrl.length > 8000 || /[\p{Cc}]/u.test(value.checkoutUrl)) return false;
      try { const url = new URL(value.checkoutUrl); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
    }
  },
  "locations.archive": locationActionOperation("archive"),
  "locations.setDefault": locationActionOperation("set-default"),
  "locations.create": locationWriteOperation("create"),
  "locations.update": locationWriteOperation("update"),
  "locations.list": {
    scopes: [],
    request(input) {
      const { archived, ...paging } = validateSchemaPayload({ schema: locationQuerySchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: "https://www.wixapis.com/locations/v1/locations/query",
        body: { query: { filter: { archived }, paging }, filterAuthorizedLocationEntities: true } };
    },
    validateResult: value => Array.isArray(value?.locations) && value.locations.length <= 100 && value.locations.every(validLocation) &&
      (value.pagingMetadata === undefined || isRecord(value.pagingMetadata) &&
        ["count", "offset", "total"].every(key => value.pagingMetadata[key] === undefined || Number.isSafeInteger(value.pagingMetadata[key]) && value.pagingMetadata[key] >= 0))
  },
  "locations.get": {
    scopes: [],
    request(input) {
      const { locationId } = validateSchemaPayload({ schema: locationGetSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `https://www.wixapis.com/locations/v1/locations/${locationId}` };
    },
    validateResult: (value, request) => validLocation(value?.location) && sameRecord(value.location.id === requestPath(request, -1), "Wix returned a different business location.", { messageCode: "connectors.wix.returnedDifferentBusinessLocation" })
  },
  "productsV1.list": productReadOperation(1, "list"),
  "productsV1.get": productReadOperation(1, "get"),
  "productsV1.update": {
    scopes: [],
    request(input) {
      const { productId, price, ...changes } = validateSchemaPayload({ schema: productV1UpdateSchema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(changes).length && price === undefined) throw new ConnectorError("connector_input_invalid", "Provide a product name, visibility or base-price change.", { statusCode: 422, messageCode: "connectors.wix.provideProductNameVisibilityBase" });
      return { method: "PATCH", url: `https://www.wixapis.com/stores/v1/products/${productId}`,
        body: { product: { ...changes, ...(price === undefined ? {} : { priceData: { price } }) } } };
    },
    validateResult: (value, request) => isUuid(value?.product?.id) && typeof value.product.name === "string" && value.product.name.length > 0 &&
      sameRecord(value.product.id === requestPath(request, -1), "Wix returned a different product.", { messageCode: "connectors.wix.returnedDifferentProduct" })
  },
  "productsV3.list": productReadOperation(3, "list"),
  "productsV3.get": productReadOperation(3, "get"),
  "productsV3.update": {
    scopes: [],
    request(input) {
      const { productId, revision, ...changes } = validateSchemaPayload({ schema: productV3UpdateSchema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(changes).length) throw new ConnectorError("connector_input_invalid", "Provide a product name or visibility change.", { statusCode: 422, messageCode: "connectors.wix.provideProductNameVisibilityChange" });
      return { method: "PATCH", url: `https://www.wixapis.com/stores/v3/products/${productId}`,
        body: { product: { id: productId, revision, ...changes } } };
    },
    validateResult: (value, request) => isUuid(value?.product?.id) && typeof value.product.name === "string" && value.product.name.length > 0 &&
      sameRecord(value.product.id === requestPath(request, -1), "Wix returned a different product.", { messageCode: "connectors.wix.returnedDifferentProduct" }) &&
      typeof value.product.revision === "string" && /^\d{1,19}$/u.test(value.product.revision) && BigInt(value.product.revision) <= 9223372036854775807n
  },
  "catalog.version": {
    scopes: [],
    request(input) {
      validateSchemaPayload({ schema: catalogVersionSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: "https://www.wixapis.com/stores/v3/provision/version" };
    }, validateResult: value => ["V1_CATALOG", "V3_CATALOG", "STORES_NOT_INSTALLED"].includes(value?.catalogVersion)
  },
  "orders.list": {
    scopes: [],
    request(input) {
      const { status, contactId, ...cursorPaging } = validateSchemaPayload({ schema: orderSearchSchema, mode: "replace" }, input, { statusCode: 422 });
      if (cursorPaging.cursor && (status || contactId)) throw new ConnectorError("connector_input_invalid", "Use only cursor and limit for the next order page.", { statusCode: 422, messageCode: "connectors.wix.useCursorLimitNextOrder" });
      const filter = { ...(status ? { status } : {}), ...(contactId ? { "buyerInfo.contactId": contactId } : {}) };
      return { method: "POST", url: "https://www.wixapis.com/ecom/v1/orders/search",
        body: { search: { cursorPaging, ...(Object.keys(filter).length ? { filter } : {}) } } };
    },
    validateResult: value => Array.isArray(value?.orders) && value.orders.length <= 100 && value.orders.every(validOrder) &&
      (value.metadata === undefined || isRecord(value.metadata) &&
        (value.metadata.count === undefined || value.metadata.count === value.orders.length) &&
        (value.metadata.hasNext === undefined || typeof value.metadata.hasNext === "boolean") &&
        (value.metadata.cursors === undefined || isRecord(value.metadata.cursors) &&
          ["next", "prev"].every(key => value.metadata.cursors[key] === undefined || cursor(value.metadata.cursors[key]))))
  },
  "orders.get": {
    scopes: [],
    request(input) {
      const { orderId } = validateSchemaPayload({ schema: orderIdSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `https://www.wixapis.com/ecom/v1/orders/${encodeURIComponent(orderId)}` };
    }, validateResult: (value, request) => validOrder(value?.order) && sameRecord(value.order.id === requestPath(request, -1), "Wix returned a different order.", { messageCode: "connectors.wix.returnedDifferentOrder" })
  },
  "orderFulfillments.create": fulfillmentWriteOperation(false),
  "orderFulfillments.update": fulfillmentWriteOperation(true),
  "orderFulfillments.list": {
    scopes: [],
    request(input) {
      const { orderId } = validateSchemaPayload({ schema: orderIdSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `https://www.wixapis.com/ecom/v1/fulfillments/orders/${encodeURIComponent(orderId)}` };
    },
    validateResult: (value, request) => isUuid(value?.orderWithFulfillments?.orderId) &&
      sameRecord(value.orderWithFulfillments.orderId === requestPath(request, -1), "Wix returned fulfillments for a different order.", { messageCode: "connectors.wix.returnedFulfillmentsDifferentOrder" }) &&
      Array.isArray(value.orderWithFulfillments.fulfillments) &&
      value.orderWithFulfillments.fulfillments.every(item => isUuid(item?.id) && Array.isArray(item.lineItems) && item.lineItems.length <= 300 &&
        item.lineItems.every(line => isUuid(line?.id) && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 100000))
  }
};

export { wixStoreOperations };
