import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { serializeNativeJson, requestPath, sameRecord } from "./wixValues.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// Wix CMS operations: data collections and their items.

const collectionId = value => typeof value === "string" && value.length > 0 && value.length <= 256 &&
  !/[\p{Cc}]/u.test(value) && value.split("/").every(part => part.length > 0 && ![".", ".."].includes(part));
const collectionListSchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }, offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 },
  consistentRead: { type: "boolean", defaultTo: false }
});
const cmsFilterField = { type: "none", validator: value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Use a Wix filter object.";
    try {
      const json = serializeNativeJson(value);
      return Buffer.byteLength(json) <= 100000 || "Keep the Wix filter within 100KB.";
    } catch { return "Use serializable JSON filter data."; }
  } };
const cmsItemQuerySchema = createSchema({
  collectionId: { type: "string", required: true, validator: value => collectionId(value) || "Use the returned Wix collection ID." },
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }, offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 },
  consistentRead: { type: "boolean", defaultTo: false },
  filter: cmsFilterField,
  sort: { type: "array", validator: values => values.length <= 100 || "Use at most 100 sort fields.", items: { type: "object", schema: createSchema({
    fieldName: { type: "string", required: true, minLength: 1, maxLength: 1000 }, order: { type: "string", required: true, enum: ["ASC", "DESC"] }
  }) } },
  fields: { type: "array", validator: values => values.length <= 1000 || "Use at most 1000 projected fields.", items: { type: "string", minLength: 1, maxLength: 5000 } },
  returnTotalCount: { type: "boolean" },
  includeReferences: { type: "array", validator: values => values.length <= 100 || "Use at most 100 reference configurations.", items: { type: "object", schema: createSchema({
    field: { type: "string", required: true, minLength: 1, maxLength: 1000 }, limit: { type: "integer", min: 1, max: 1000 }
  }) } }
});
const cmsItemIdField = { type: "string", required: true, minLength: 1, maxLength: 128,
  validator: value => !/[\p{Cc}]/u.test(value) && ![".", ".."].includes(value) || "Use a returned Wix item ID." };
const cmsItemGetSchema = createSchema({
  collectionId: { type: "string", required: true, validator: value => collectionId(value) || "Use the returned Wix collection ID." },
  itemId: cmsItemIdField, consistentRead: { type: "boolean", defaultTo: false }
});
const cmsItemPatchSchema = createSchema({
  collectionId: { type: "string", required: true, validator: value => collectionId(value) || "Use the returned Wix collection ID." },
  itemId: cmsItemIdField, conditionFilter: cmsFilterField,
  fieldModifications: { type: "none", required: true, validator: values => {
    if (!Array.isArray(values) || values.length < 1 || values.length > 100) return "Provide 1–100 Wix field modifications.";
    const options = { SET_FIELD: "setFieldOptions", INCREMENT_FIELD: "incrementFieldOptions", APPEND_TO_ARRAY: "appendToArrayOptions", REMOVE_FROM_ARRAY: "removeFromArrayOptions" };
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.fieldPath !== "string" ||
          !value.fieldPath.length || value.fieldPath.length > 1000 || /[\p{Cc}]/u.test(value.fieldPath)) return "Use a Wix field path for each modification.";
      if (value.action === "REMOVE_FIELD") {
        if (Object.keys(value).some(key => !["fieldPath", "action"].includes(key))) return "REMOVE_FIELD accepts no value options.";
      } else {
        const key = Object.hasOwn(options, value.action) ? options[value.action] : undefined;
        if (!key || Object.keys(value).some(name => !["fieldPath", "action", key].includes(name))) return "Use the options matching the Wix patch action.";
        const config = value[key];
        if (!config || typeof config !== "object" || Array.isArray(config) || !Object.hasOwn(config, "value") || Object.keys(config).length !== 1) return "Provide the patch action's value.";
        if (value.action === "INCREMENT_FIELD" && (typeof config.value !== "number" || !Number.isFinite(config.value))) return "Use a finite increment value.";
      }
    }
    try {
      const json = serializeNativeJson(values);
      return Buffer.byteLength(json) <= 100000 || "Keep field modifications within 100KB.";
    } catch { return "Use serializable JSON field values."; }
  } }
});
const collectionGetSchema = createSchema({
  collectionId: { type: "string", required: true, validator: value => collectionId(value) || "Use the returned Wix collection ID." },
  consistentRead: { type: "boolean", defaultTo: false }
});
const validCollection = value => collectionId(value?.id) &&
  (value.fields === undefined || Array.isArray(value.fields)) && (value.displayName === undefined || typeof value.displayName === "string");
const wixCmsOperations = {
  "cmsItems.get": {
    scopes: [],
    request(input) {
      const { collectionId: dataCollectionId, itemId, consistentRead } = validateSchemaPayload({ schema: cmsItemGetSchema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(itemId)}`);
      url.searchParams.set("dataCollectionId", dataCollectionId); url.searchParams.set("consistentRead", String(consistentRead));
      return { method: "GET", url: url.href };
    },
    validateResult: (value, request) => isRecord(value?.dataItem?.data) &&
      sameRecord(value.dataItem.id === requestPath(request, -1) && value.dataItem.dataCollectionId === new URL(request.url).searchParams.get("dataCollectionId"), "Wix returned a different CMS item or collection. Check write outcomes before retrying.", { messageCode: "connectors.wix.returnedDifferentCmsItemCollection" })
  },
  "cmsItems.patch": {
    scopes: [],
    request(input) {
      const { collectionId: dataCollectionId, itemId, fieldModifications, conditionFilter } = validateSchemaPayload({ schema: cmsItemPatchSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "PATCH", url: `https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(itemId)}`,
        body: { dataCollectionId, patch: { dataItemId: itemId, fieldModifications }, ...(conditionFilter !== undefined ? { condition: { filter: conditionFilter } } : {}) } };
    },
    validateResult: (value, request) => isRecord(value?.dataItem?.data) &&
      sameRecord(value.dataItem.id === requestPath(request, -1) && value.dataItem.dataCollectionId === request.body.dataCollectionId, "Wix returned a different CMS item or collection. Check write outcomes before retrying.", { messageCode: "connectors.wix.returnedDifferentCmsItemCollection" })
  },
  "cmsItems.list": {
    scopes: [],
    request(input) {
      const { collectionId: dataCollectionId, consistentRead, filter, sort, fields, returnTotalCount, includeReferences, ...paging } = validateSchemaPayload({ schema: cmsItemQuerySchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: "https://www.wixapis.com/wix-data/v2/items/query",
        body: { dataCollectionId, consistentRead,
          ...(returnTotalCount !== undefined ? { returnTotalCount } : {}), ...(includeReferences !== undefined ? { includeReferences } : {}),
          query: { paging, ...(filter !== undefined ? { filter } : {}), ...(sort !== undefined ? { sort } : {}), ...(fields !== undefined ? { fields } : {}) } } };
    },
    validateResult: (value, request) => Array.isArray(value?.dataItems) && value.dataItems.length <= 100 && value.dataItems.every(item =>
      typeof item?.id === "string" && item.id.length > 0 && collectionId(item.dataCollectionId) && isRecord(item.data)) &&
      (value.pagingMetadata === undefined || isRecord(value.pagingMetadata)) &&
      sameRecord(value.dataItems.every(item => item.dataCollectionId === request.body.dataCollectionId), "Wix returned items from a different CMS collection.", { messageCode: "connectors.wix.returnedItemsDifferentCmsCollection" })
  },
  "cmsCollections.list": {
    scopes: [],
    request(input) {
      const value = validateSchemaPayload({ schema: collectionListSchema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL("https://www.wixapis.com/wix-data/v2/collections");
      url.searchParams.set("paging.limit", String(value.limit)); url.searchParams.set("paging.offset", String(value.offset));
      url.searchParams.set("consistentRead", String(value.consistentRead));
      return { method: "GET", url: url.href };
    },
    validateResult: value => Array.isArray(value?.collections) && value.collections.length <= 100 && value.collections.every(validCollection) &&
      (value.pagingMetadata === undefined || isRecord(value.pagingMetadata))
  },
  "cmsCollections.get": {
    scopes: [],
    request(input) {
      const value = validateSchemaPayload({ schema: collectionGetSchema, mode: "replace" }, input, { statusCode: 422 });
      const id = value.collectionId.split("/").map(encodeURIComponent).join("/");
      return { method: "GET", url: `https://www.wixapis.com/wix-data/v2/collections/${id}?consistentRead=${value.consistentRead}` };
    },
    validateResult: (value, request) => validCollection(value?.collection) &&
      sameRecord(value.collection.id === new URL(request.url).pathname.split("/").slice(4).map(decodeURIComponent).join("/"), "Wix returned a different CMS collection.", { messageCode: "connectors.wix.returnedDifferentCmsCollection" })
  }
};

export { wixCmsOperations };
