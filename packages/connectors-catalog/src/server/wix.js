import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { wixDefinition } from "../shared/wix.js";

// Preserve native Wix JSON without silently dropping unsupported values.
function serializeNativeJson(value) {
  return JSON.stringify(value, (key, item) => {
    if (["undefined", "function", "symbol", "bigint"].includes(typeof item) ||
        typeof item === "number" && !Number.isFinite(item)) throw new Error("JSON required");
    return item;
  });
}

const guid = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
const cursor = (value) => typeof value === "string" && value.length > 0 && value.length <= 16000 && !/[\p{Cc}]/u.test(value);
const querySchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  cursor: { type: "string", minLength: 1, maxLength: 16000, noTrim: true, validator: (value) => cursor(value) || "Use the returned Wix page cursor." }
});
const contactsSchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 },
  search: { type: "string", minLength: 1, maxLength: 100 }
});
function bookingDirectoryOperation(kind) {
  const staff = kind === "staff";
  return {
    scopes: [],
    request(input, settings) {
      const cursorPaging = validateSchemaPayload({ schema: querySchema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
      return { method: "POST", url: staff ? "https://www.wixapis.com/bookings/v1/staff-members/query" : "https://www.wixapis.com/bookings/v2/categories/query",
        headers: { "wix-site-id": settings.siteId }, body: {
          query: { cursorPaging, sort: [{ fieldName: "id", order: "ASC" }], ...(staff ? { filter: { serviceProvider: true } } : {}) },
          ...(staff ? { fields: ["RESOURCE_DETAILS"] } : {})
        } };
    },
    validateResult(value) {
      const values = staff ? value?.staffMembers : value?.categories;
      const paging = value?.pagingMetadata;
      return Array.isArray(values) && values.length <= 100 && values.every(item => guid(item?.id) && typeof item.name === "string" &&
        (!staff || guid(item.resourceId))) && (paging === undefined || paging && typeof paging === "object" && !Array.isArray(paging) &&
          (paging.hasNext === undefined || typeof paging.hasNext === "boolean") &&
          (paging.cursors === undefined || paging.cursors && typeof paging.cursors === "object" && !Array.isArray(paging.cursors) &&
            ["next", "prev"].every(key => paging.cursors[key] === undefined || cursor(paging.cursors[key]))));
    }
  };
}
const contactIdField = { type: "string", required: true, validator: value => guid(value) || "Use the contact ID returned by Wix." };
const contactInfoSchema = createSchema({
  name: { type: "object", schema: createSchema({ first: { type: "string", maxLength: 1000 }, last: { type: "string", maxLength: 1000 } }) },
  company: { type: "string", maxLength: 1000 }, jobTitle: { type: "string", maxLength: 1000 },
  emails: { type: "object", schema: createSchema({ items: { type: "array", required: true, validator: values => values.length <= 50 || "Use at most 50 email addresses.",
    items: { type: "object", schema: createSchema({ email: { type: "string", required: true, minLength: 1, maxLength: 320 },
      primary: { type: "boolean" }, tag: { type: "string", enum: ["UNTAGGED", "MAIN", "HOME", "WORK"] } }) } } }) },
  phones: { type: "object", schema: createSchema({ items: { type: "array", required: true, validator: values => values.length <= 50 || "Use at most 50 phone numbers.",
    items: { type: "object", schema: createSchema({ phone: { type: "string", required: true, minLength: 1, maxLength: 50 },
      countryCode: { type: "string", validator: value => /^[A-Z]{2}$/u.test(value) || "Use a two-letter country code." }, primary: { type: "boolean" } }) } } }) }
});
const validContact = value => guid(value?.id) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
  value.info && typeof value.info === "object" && !Array.isArray(value.info);
function contactOperation(action) {
  const fields = action === "get" ? { contactId: contactIdField } : {
    ...(action === "update" ? { contactId: contactIdField, revision: { type: "integer", required: true, min: 0, max: 2147483647 } } : {}),
    info: { type: "object", required: true, schema: contactInfoSchema }, allowDuplicates: { type: "boolean", defaultTo: false }
  };
  const schema = createSchema(fields);
  return {
    scopes: [],
    request(input, settings) {
      const { contactId, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the project's Wix Site ID first.", { statusCode: 422 });
      if (action !== "get" && (!Object.keys(body.info).length || (action === "create" &&
          !(body.info.name?.first || body.info.name?.last || body.info.emails?.items?.length || body.info.phones?.items?.length)))) {
        throw new ConnectorError("connector_input_invalid", "Provide contact details; creation requires a name, email or phone.", { statusCode: 422 });
      }
      return { method: action === "get" ? "GET" : action === "create" ? "POST" : "PATCH",
        url: `https://www.wixapis.com/contacts/v4/contacts${contactId ? `/${contactId}` : ""}`,
        headers: { "wix-site-id": settings.siteId }, ...(action === "get" ? {} : { body }) };
    },
    validateResult: value => validContact(value?.contact)
  };
}
const servicePagingSchema = createSchema({ limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }, offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 } });
const serviceIdSchema = createSchema({ serviceId: contactIdField });
const nativeJsonObjectField = { type: "none", validator: value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Use a native Wix JSON object.";
  try {
    const json = serializeNativeJson(value);
    return Buffer.byteLength(json) <= 100000 || "Keep native Wix object data within 100KB.";
  } catch { return "Use serializable native Wix JSON data."; }
} };
const serviceUpdateSchema = createSchema({
  serviceId: contactIdField,
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the returned service revision string." },
  name: { type: "string", minLength: 1, maxLength: 400 }, description: { type: "string", maxLength: 7000 }, tagLine: { type: "string", maxLength: 6000 },
  payment: nativeJsonObjectField,
  onlineBooking: { type: "object", schema: createSchema({ enabled: { type: "boolean" }, requireManualApproval: { type: "boolean" }, allowMultipleRequests: { type: "boolean" } }) },
  defaultCapacity: { type: "integer", min: 1, max: 1000 },
  staffMemberIds: { type: "array", validator: values => values.length > 0 && values.length <= 100 || "Select 1–100 staff resource IDs.", items: { type: "string", validator: value => guid(value) || "Use a staff resource ID." } },
  schedule: { type: "object", schema: createSchema({ availabilityConstraints: { type: "object", required: true, schema: createSchema({
    sessionDurations: { type: "array", validator: values => values.length > 0 && values.length <= 50 || "Use 1–50 appointment durations.", items: { type: "integer", min: 1 } },
    timeBetweenSessions: { type: "integer", min: 0 }
  }) } }) }
});
const validService = value => guid(value?.id) && typeof value.name === "string" && typeof value.revision === "string" && /^\d{1,19}$/u.test(value.revision) &&
  ["APPOINTMENT", "CLASS", "COURSE"].includes(value.type);
const localDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(value) &&
  Number.isFinite(Date.parse(`${value}Z`)) && new Date(`${value}Z`).toISOString().slice(0, 19) === value;
const validSlot = value => guid(value?.serviceId) && localDate(value.localStartDate) && localDate(value.localEndDate) &&
  value.localStartDate < value.localEndDate && typeof value.bookable === "boolean";
const availabilityLocationSchema = createSchema({
  id: { type: "string", validator: value => guid(value) || "Use the Wix business location ID." },
  locationType: { type: "string", required: true, enum: ["BUSINESS", "CUSTOM", "CUSTOMER"] },
  name: { type: "string", maxLength: 1000 }, formattedAddress: { type: "string", maxLength: 4000 }
});
function availabilityOperation(action, events = false) {
  const schema = createSchema({
    ...(!events ? {
      customerChoices: { type: "object", schema: createSchema({
        durationInMinutes: { type: "integer", min: 1, max: 57600 },
        addOnIds: { type: "array", validator: values => values.length > 0 && values.length <= 21 && new Set(values).size === values.length || "Select 1–21 distinct add-ons.",
          items: { type: "string", validator: value => guid(value) || "Use the add-on ID returned by Wix." } }
      }) },
      includeResourceTypeIds: { type: "array", validator: values => values.length <= 100 || "Choose at most 100 resource types.", items: { type: "string", validator: value => guid(value) || "Use a resource type ID." } },
      ...(action === "list" ? { locations: { type: "array", validator: values => values.length <= 5 || "Choose at most five locations.", items: { type: "object", schema: availabilityLocationSchema } } } : {
        location: { type: "object", schema: availabilityLocationSchema },
        resourceTypes: { type: "array", validator: values => values.length <= 8 || "Choose at most eight resource types.", items: { type: "object", schema: createSchema({
          resourceTypeId: { type: "string", required: true, validator: value => guid(value) || "Use a resource type ID." },
          resourceIds: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 135 || "Choose 1–135 resource IDs.", items: { type: "string", validator: value => guid(value) || "Use a resource ID." } }
        }) } }
      })
    } : {}),
    ...(events ? { minBookableCapacity: { type: "integer", min: 1, max: 1000 } } : {}),
    serviceId: { type: "string", validator: value => guid(value) || "Use the appointment service ID." },
    ...(action === "list" ? {
      fromLocalDate: { type: "string", validator: value => localDate(value) || "Use YYYY-MM-DDThh:mm:ss without an offset." },
      toLocalDate: { type: "string", validator: value => localDate(value) || "Use YYYY-MM-DDThh:mm:ss without an offset." },
      limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      cursor: { type: "string", validator: value => cursor(value) || "Use the returned page cursor." }
    } : {
      localStartDate: { type: "string", required: true, validator: value => localDate(value) || "Use the returned local start date." },
      localEndDate: { type: "string", required: true, validator: value => localDate(value) || "Use the returned local end date." }
    }),
    timeZone: { type: "string", maxLength: events ? 100 : 150, validator: value => {
      try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Use an IANA time zone."; }
    } }
  });
  return {
    scopes: [],
    request(input, settings) {
      const { limit, cursor: next, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
      if (next && Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Use only cursor and limit for the next availability page.", { statusCode: 422 });
      if (body.customerChoices && !Object.keys(body.customerChoices).length) throw new ConnectorError("connector_input_invalid", "Select a duration or add-ons before supplying customer choices.", { statusCode: 422 });
      if (!next && (!body.serviceId || !body.timeZone || (action === "list" ? !body.fromLocalDate || !body.toLocalDate || body.fromLocalDate >= body.toLocalDate : body.localStartDate >= body.localEndDate))) {
        throw new ConnectorError("connector_input_invalid", "Choose the service, time zone and an increasing local date range.", { statusCode: 422 });
      }
      const locations = body.locations ?? (body.location ? [body.location] : []);
      if (locations.some(location => location.locationType === "BUSINESS" && !location.id)) throw new ConnectorError("connector_input_invalid", "Choose the business location ID.", { statusCode: 422 });
      const { serviceId, ...eventBody } = body;
      return { method: "POST", url: `https://www.wixapis.com/_api/service-availability/v2/time-slots${events ? "/event" : action === "get" ? "/get" : ""}`,
        headers: { "wix-site-id": settings.siteId }, body: action === "get" ? body : next ? { cursorPaging: { limit, cursor: next } } : { ...(events ? { ...eventBody, serviceIds: [serviceId], includeNonBookable: false } : { ...body, bookable: true }), cursorPaging: { limit } } };
    },
    validateResult: value => typeof value?.timeZone === "string" && (action === "get" ? validSlot(value.timeSlot) :
      Array.isArray(value.timeSlots) && value.timeSlots.length <= 1000 && value.timeSlots.every(slot => validSlot(slot) && (!events || typeof slot.eventInfo?.eventId === "string" && slot.eventInfo.eventId.length >= 36 && slot.eventInfo.eventId.length <= 250)) &&
      (value[events ? "pagingMetadata" : "cursorPagingMetadata"] === undefined || value[events ? "pagingMetadata" : "cursorPagingMetadata"] && typeof value[events ? "pagingMetadata" : "cursorPagingMetadata"] === "object" && !Array.isArray(value[events ? "pagingMetadata" : "cursorPagingMetadata"]) &&
        (value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors === undefined || value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors && typeof value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors === "object" && !Array.isArray(value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors) &&
          ["next", "prev"].every(key => value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors[key] === undefined || cursor(value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors[key])))))
  };
}
const eventSlotSchema = createSchema({
  eventId: { type: "string", required: true, minLength: 36, maxLength: 250, validator: value => !/[\p{Cc}]/u.test(value) || "Use the returned event ID." },
  timeZone: { type: "string", required: true, maxLength: 100, validator: value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Use an IANA time zone."; }
  } }
});
function productReadOperation(version, action) {
  const schema = createSchema(action === "get" ? {
    productId: { type: "string", required: true, validator: value => guid(value) || "Use the Wix product ID." }
  } : {
    limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
    ...(version === 1 ? { offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 }, includeVariants: { type: "boolean", defaultTo: false } } :
      { cursor: { type: "string", validator: value => cursor(value) || "Use the returned product cursor." } })
  });
  const validProduct = value => guid(value?.id) && typeof value.name === "string" && value.name.length > 0;
  return {
    scopes: [],
    request(input, settings) {
      const value = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
      const base = version === 1 ? "https://www.wixapis.com/stores-reader/v1/products" : "https://www.wixapis.com/stores/v3/products";
      if (action === "get") return { method: "GET", url: `${base}/${value.productId}`, headers: { "wix-site-id": settings.siteId } };
      const { includeVariants, ...paging } = value;
      return { method: "POST", url: `${base}/query`, headers: { "wix-site-id": settings.siteId },
        body: version === 1 ? { query: { paging }, includeVariants } : { query: { cursorPaging: paging } } };
    },
    validateResult: value => action === "get" ? validProduct(value?.product) : Array.isArray(value?.products) && value.products.length <= 100 && value.products.every(validProduct) &&
      (version === 1 ? (value.totalResults === undefined || Number.isSafeInteger(value.totalResults) && value.totalResults >= 0) &&
        (value.metadata === undefined || value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) &&
          ["items", "offset"].every(key => value.metadata[key] === undefined || Number.isSafeInteger(value.metadata[key]) && value.metadata[key] >= 0)) :
        (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata) &&
          (value.pagingMetadata.cursors === undefined || value.pagingMetadata.cursors && typeof value.pagingMetadata.cursors === "object" && !Array.isArray(value.pagingMetadata.cursors) &&
            ["next", "prev"].every(key => value.pagingMetadata.cursors[key] === undefined || cursor(value.pagingMetadata.cursors[key])))))
  };
}
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
const serviceLocationSchema = createSchema({
  type: { type: "string", required: true, enum: ["BUSINESS", "CUSTOM", "CUSTOMER"] },
  business: { type: "object", schema: createSchema({ id: contactIdField }) },
  custom: { type: "object", schema: createSchema({ address: { ...nativeJsonObjectField, required: true } }) }
});
const setServiceLocationsSchema = createSchema({
  serviceId: contactIdField,
  locations: { type: "array", required: true, validator: values => values.length <= 100 || "Use at most 100 locations.", items: { type: "object", schema: serviceLocationSchema } },
  removedLocationAction: { type: "string", required: true, enum: ["KEEP_AT_CURRENT_LOCATION", "MOVE_TO_LOCATION"] },
  moveToLocation: { type: "object", schema: serviceLocationSchema },
  notifyParticipants: { type: "boolean", defaultTo: false }, notificationMessage: { type: "string", maxLength: 2000 }
});
const serviceCreateSchema = createSchema({ service: { ...nativeJsonObjectField, required: true } });
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
    request(input, settings) {
      const { locationId, ...location } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
      if (!Object.keys(location.address).length) throw new ConnectorError("connector_input_invalid", "Provide the location address.", { statusCode: 422 });
      if (location.businessSchedule && (["periods", "specialHourPeriod"].some(key => location.businessSchedule[key] !== undefined &&
          (!Array.isArray(location.businessSchedule[key]) || location.businessSchedule[key].length > 100)) ||
          Object.keys(location.businessSchedule).some(key => !["periods", "specialHourPeriod"].includes(key)))) {
        throw new ConnectorError("connector_input_invalid", "Use native businessSchedule periods and specialHourPeriod arrays with at most 100 entries each.", { statusCode: 422 });
      }
      return { method: action === "create" ? "POST" : "PUT", url: `https://www.wixapis.com/locations/v1/locations${locationId ? `/${locationId}` : ""}`,
        headers: { "wix-site-id": settings.siteId }, body: { location: { ...(locationId ? { id: locationId } : {}), ...location } } };
    },
    validateResult: value => validLocation(value?.location) && typeof value.location.revision === "string" && /^\d{1,19}$/u.test(value.location.revision)
  };
}
function locationActionOperation(action) {
  const schema = createSchema({ locationId: contactIdField });
  return {
    scopes: [],
    request(input, settings) {
      const { locationId } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
      return { method: "POST", url: `https://www.wixapis.com/locations/v1/locations/${locationId}/${action}`,
        headers: { "wix-site-id": settings.siteId }, body: {} };
    },
    validateResult: value => validLocation(value?.location) && (action === "archive" ? value.location.archived === true : value.location.default === true)
  };
}
const locationQuerySchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }, offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 },
  archived: { type: "boolean", defaultTo: false }
});
const locationGetSchema = createSchema({ locationId: { type: "string", required: true, validator: value => guid(value) || "Use the returned location ID." } });
const validLocation = value => guid(value?.id) && typeof value.name === "string" &&
  (value.timeZone === undefined || typeof value.timeZone === "string") && (value.archived === undefined || typeof value.archived === "boolean");
const productV1UpdateSchema = createSchema({
  productId: { type: "string", required: true, validator: value => guid(value) || "Use the Wix product ID." },
  name: { type: "string", minLength: 1, maxLength: 80 }, visible: { type: "boolean" },
  price: { type: "none", validator: value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 999999999.99 || "Use a numeric Wix base price from 0 to 999999999.99." }
});
const productV3UpdateSchema = createSchema({
  productId: { type: "string", required: true, validator: value => guid(value) || "Use the Wix product ID." },
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current product revision string." },
  name: { type: "string", minLength: 1, maxLength: 80 },
  visible: { type: "boolean" }
});
const catalogVersionSchema = createSchema({});
const orderSearchSchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  cursor: { type: "string", validator: value => cursor(value) || "Use the returned order cursor." },
  status: { type: "string", minLength: 1, maxLength: 100 },
  contactId: { type: "string", validator: value => guid(value) || "Use the buyer's contact ID." }
});
const orderIdSchema = createSchema({ orderId: { type: "string", required: true, minLength: 1, maxLength: 100, validator: value => !/[\p{Cc}]/u.test(value) && ![".", ".."].includes(value) || "Use the returned order ID." } });
const cartCreateSchema = createSchema({
  note: { type: "string", maxLength: 1000 },
  catalogItems: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 300 || "Select 1–300 catalogue items.",
    items: { type: "object", schema: createSchema({
      quantity: { type: "integer", required: true, min: 1, max: 100000 },
      catalogReference: { type: "object", required: true, schema: createSchema({
        appId: { type: "string", required: true, validator: value => guid(value) || "Use the catalogue app ID." },
        catalogItemId: { type: "string", required: true, minLength: 1, maxLength: 36, validator: value => !/[\p{Cc}]/u.test(value) || "Use the selected catalogue item ID." },
        options: nativeJsonObjectField
      }) }
    }) } }
});
const cartIdSchema = createSchema({ cartId: { type: "string", required: true, validator: value => guid(value) || "Use the cart ID returned by Wix." } });
const validOrder = value => typeof value?.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
  typeof value.status === "string" && value.status.length > 0 && (value.currency === undefined || typeof value.currency === "string") &&
  (value.lineItems === undefined || Array.isArray(value.lineItems));
const formSummarySchema = createSchema({ formId: { type: "string", required: true, validator: value => guid(value) || "Use the service form ID." } });
const bookingCreateSchema = createSchema({
  serviceId: { type: "string", required: true, validator: value => guid(value) || "Use the Wix service ID." },
  kind: { type: "string", required: true, enum: ["APPOINTMENT", "CLASS", "COURSE"] },
  timeZone: { type: "string", required: true, maxLength: 150, validator: value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Use an IANA time zone."; }
  } },
  startDate: { type: "string", validator: value => localDate(value) || "Use the selected slot's local start date." },
  endDate: { type: "string", validator: value => localDate(value) || "Use the selected slot's local end date." },
  eventId: { type: "string", minLength: 36, maxLength: 250, validator: value => !/[\p{Cc}]/u.test(value) || "Use the returned event ID." },
  scheduleId: { type: "string", validator: value => guid(value) || "Use the course schedule ID." },
  resourceId: { type: "string", validator: value => guid(value) || "Use the selected resource ID." },
  location: { type: "object", schema: createSchema({
    id: { type: "string", validator: value => guid(value) || "Use the business location ID." },
    locationType: { type: "string", required: true, enum: ["OWNER_BUSINESS", "OWNER_CUSTOM", "CUSTOM"] },
    name: { type: "string", maxLength: 1000 }, formattedAddress: { type: "string", maxLength: 4000 }
  }) },
  totalParticipants: { type: "integer", min: 1, max: 1000 },
  participantsChoices: { type: "object", schema: createSchema({
    serviceChoices: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 20 || "Use 1–20 participant groups.",
      items: { type: "object", schema: createSchema({
        numberOfParticipants: { type: "integer", required: true, min: 1, max: 1000 },
        choices: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 5 || "Use 1–5 service choices per group.",
          items: { type: "object", schema: createSchema({
            optionId: { type: "string", required: true, validator: value => guid(value) || "Use the option ID returned by Wix." },
            custom: { type: "string", minLength: 1, maxLength: 1000 },
            duration: { type: "object", schema: createSchema({ minutes: { type: "integer", required: true, min: 1, max: 44639 }, name: { type: "string", maxLength: 255 } }) }
          }) } }
      }) } }
  }) },
  bookedAddOns: { type: "array", validator: values => values.length > 0 && values.length <= 21 && new Set(values.map(value => value?.id)).size === values.length || "Select 1–21 distinct add-ons.",
    items: { type: "object", schema: createSchema({
      id: { type: "string", required: true, validator: value => guid(value) || "Use the add-on ID returned by Wix." },
      groupId: { type: "string", validator: value => guid(value) || "Use the add-on group ID." },
      quantity: { type: "integer", min: 1, max: 1000 }
    }) } },
  formSubmission: { type: "none", required: true, validator: value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Provide the booking form's field-value object.";
    try {
      const json = serializeNativeJson(value);
      return Buffer.byteLength(json) <= 100000 || "Keep booking form data within 100KB.";
    } catch { return "Use serializable JSON booking form data."; }
  } },
  notifyParticipants: { type: "boolean", defaultTo: false }, sendSmsReminder: { type: "boolean", defaultTo: false }
});
const bookingQuerySchema = createSchema({
  bookingId: { type: "string", validator: value => guid(value) || "Use the Wix booking ID." },
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 }
});
const bookingCancelSchema = createSchema({
  bookingId: { type: "string", required: true, validator: value => guid(value) || "Use the Wix booking ID." },
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current booking revision string." },
  notifyParticipants: { type: "boolean", defaultTo: false },
  message: { type: "string", maxLength: 2000 },
  waiveCharges: { type: "boolean", defaultTo: false }
});
const bookingRescheduleSchema = createSchema({
  bookingId: { type: "string", required: true, validator: value => guid(value) || "Use the Wix booking ID." },
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current booking revision string." },
  slot: { ...nativeJsonObjectField, required: true },
  notifyParticipants: { type: "boolean", defaultTo: false }, message: { type: "string", maxLength: 2000 }
});
function bookingConfirmationOperation(action) {
  const automatic = action === "confirmOrDecline";
  const schema = createSchema({
    bookingId: { type: "string", required: true, validator: value => guid(value) || "Use the Wix booking ID." },
    ...(automatic ? {
      paymentStatus: { type: "string", required: true, enum: ["UNDEFINED", "NOT_PAID", "PAID", "PARTIALLY_PAID", "REFUNDED", "EXEMPT"] }
    } : {
      revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current booking revision string." },
      notifyParticipants: { type: "boolean", defaultTo: false }, message: { type: "string", maxLength: 2000 }
    })
  });
  return {
    scopes: [],
    request(input, settings) {
      const { bookingId, paymentStatus, revision, notifyParticipants, message } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
      if (message !== undefined && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification before supplying a message.", { statusCode: 422 });
      return { method: "POST", url: automatic ? `https://www.wixapis.com/bookings/v2/confirmation/${bookingId}:confirmOrDecline` :
        `https://www.wixapis.com/_api/bookings-service/v2/bookings/${bookingId}/${action}`, headers: { "wix-site-id": settings.siteId },
        body: automatic ? { paymentStatus } : { revision, participantNotification: { notifyParticipants, ...(message === undefined ? {} : { message }) } } };
    },
    validateResult: value => guid(value?.booking?.id) && typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) &&
      BigInt(value.booking.revision) <= 9223372036854775807n && (automatic ? ["CONFIRMED", "PENDING", "DECLINED"].includes(value.booking.status) : value.booking.status === (action === "confirm" ? "CONFIRMED" : "DECLINED"))
  };
}
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
    request(input, settings) {
      const { orderId, fulfillmentId, ...fulfillment } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
      if (!Object.keys(fulfillment).length || fulfillment.trackingInfo && !Object.keys(fulfillment.trackingInfo).length) {
        throw new ConnectorError("connector_input_invalid", "Supply the fulfillment properties to write.", { statusCode: 422 });
      }
      const tracking = fulfillment.trackingInfo;
      if (!update && tracking && (!tracking.trackingNumber || !tracking.shippingProvider ||
          !["fedex", "ups", "usps", "dhl", "canadaPost"].includes(tracking.shippingProvider) && !tracking.trackingLink)) {
        throw new ConnectorError("connector_input_invalid", "Supply tracking number and provider; custom carriers also require a tracking URL.", { statusCode: 422 });
      }
      return { method: update ? "PATCH" : "POST", url: update
        ? `https://www.wixapis.com/ecom/v1/fulfillments/${fulfillmentId}/orders/${encodeURIComponent(orderId)}`
        : `https://www.wixapis.com/ecom/v1/fulfillments/orders/${encodeURIComponent(orderId)}/create-fulfillment`,
        headers: { "wix-site-id": settings.siteId }, body: { fulfillment } };
    },
    validateResult: value => typeof value?.orderWithFulfillments?.orderId === "string" && Array.isArray(value.orderWithFulfillments.fulfillments) &&
      value.orderWithFulfillments.fulfillments.every(item => guid(item?.id) && Array.isArray(item.lineItems) && item.lineItems.length <= 300 &&
        item.lineItems.every(line => guid(line?.id) && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 100000)) &&
      (update || guid(value.fulfillmentId) && value.orderWithFulfillments.fulfillments.some(item => item.id === value.fulfillmentId))
  };
}
const wixRuntime = {
  ...wixDefinition, apiOrigins: ["https://www.wixapis.com"],
  apiKey: { headers: (key, settings) => ({ Authorization: key, "wix-account-id": settings.accountId }) },
  checkOperation: "sites.list",
  async exchange(address, options, { request }) {
    const headers = { ...options.headers };
    if (headers["wix-site-id"]) delete headers["wix-account-id"];
    const result = await request(address, { ...options, headers });
    const contactMatch = /\/contacts\/v4\/contacts\/([a-f0-9-]{36})$/iu.exec(new URL(address).pathname);
    if (contactMatch && result?.contact?.id !== contactMatch[1]) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different contact. Check the operation outcome before retrying.", { statusCode: 502 });
    }
    const serviceMatch = /\/_api\/bookings\/v2\/services\/([a-f0-9-]{36})(?:\/locations)?$/iu.exec(new URL(address).pathname);
    if (serviceMatch && result?.service?.id !== serviceMatch[1]) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different booking service. Check the outcome before retrying.", { statusCode: 502 });
    }
    const bookingMatch = /\/_api\/bookings-service\/v2\/bookings\/([a-f0-9-]{36})\/(?:cancel|confirm|decline|reschedule)$/iu.exec(new URL(address).pathname) ??
      /^\/bookings\/v2\/confirmation\/([a-f0-9-]{36}):confirmOrDecline$/iu.exec(new URL(address).pathname);
    const variantsMatch = /^\/bookings\/v1\/serviceOptionsAndVariants\/service_id\/([a-f0-9-]{36})$/iu.exec(new URL(address).pathname);
    if (variantsMatch && result?.serviceVariants?.serviceId !== variantsMatch[1]) {
      throw new ConnectorError("connector_response_invalid", "Wix returned variants for a different service.", { statusCode: 502 });
    }
    if (bookingMatch && result?.booking?.id !== bookingMatch[1]) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different booking. Check the operation outcome before retrying.", { statusCode: 502 });
    }
    if (new URL(address).pathname === "/_api/bookings-reader/v2/extended-bookings/query") {
      const id = options.body?.query?.filter?.id;
      if (id && Array.isArray(result?.extendedBookings) && (result.extendedBookings.length > 1 || result.extendedBookings.some(value => value?.booking?.id !== id))) {
        throw new ConnectorError("connector_response_invalid", "Wix returned an unexpected booking for the requested ID.", { statusCode: 502 });
      }
    }
    if (new URL(address).pathname.startsWith("/_api/service-availability/v2/time-slots")) {
      const requested = options.body;
      const slots = result?.timeSlots ?? (result?.timeSlot ? [result.timeSlot] : []);
      if (Array.isArray(slots) && (requested?.timeZone && result?.timeZone !== requested.timeZone || slots.some(slot =>
        requested?.serviceId && slot?.serviceId !== requested.serviceId || requested?.localStartDate && (slot?.localStartDate !== requested.localStartDate || slot?.localEndDate !== requested.localEndDate)))) {
        throw new ConnectorError("connector_response_invalid", "Wix returned availability for a different service, time or time zone.", { statusCode: 502 });
      }
    }
    const formMatch = /\/form-schema-service\/v4\/forms\/([a-f0-9-]{36})\/summary$/iu.exec(new URL(address).pathname);
    if (formMatch && result?.formSummary?.id !== formMatch[1]) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different form summary.", { statusCode: 502 });
    }
    const eventMatch = /\/_api\/service-availability\/v2\/time-slots\/event\/(.+)$/u.exec(new URL(address).pathname);
    if (eventMatch && (result?.timeSlot?.eventInfo?.eventId !== decodeURIComponent(eventMatch[1]) || result?.timeZone !== new URL(address).searchParams.get("timeZone"))) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different event slot or time zone.", { statusCode: 502 });
    }
    if (new URL(address).pathname === "/_api/service-availability/v2/time-slots/event" && options.body?.serviceIds && Array.isArray(result?.timeSlots) &&
        result.timeSlots.some(slot => !options.body.serviceIds.includes(slot?.serviceId))) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a class slot for a different service.", { statusCode: 502 });
    }
    const orderMatch = /\/ecom\/v1\/orders\/([^/]+)$/u.exec(new URL(address).pathname);
    if (options.method === "GET" && orderMatch && result?.order?.id !== decodeURIComponent(orderMatch[1])) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different order.", { statusCode: 502 });
    }
    const fulfillmentOrderMatch = /\/ecom\/v1\/fulfillments(?:\/[a-f0-9-]{36})?\/orders\/([^/]+)(?:\/create-fulfillment)?$/iu.exec(new URL(address).pathname);
    if (fulfillmentOrderMatch && result?.orderWithFulfillments?.orderId !== decodeURIComponent(fulfillmentOrderMatch[1])) {
      throw new ConnectorError("connector_response_invalid", "Wix returned fulfillments for a different order.", { statusCode: 502 });
    }
    const updatedFulfillmentMatch = /^\/ecom\/v1\/fulfillments\/([a-f0-9-]{36})\/orders\//iu.exec(new URL(address).pathname);
    if (options.method === "PATCH" && updatedFulfillmentMatch &&
        (!Array.isArray(result?.orderWithFulfillments?.fulfillments) || !result.orderWithFulfillments.fulfillments.some(item => item?.id === updatedFulfillmentMatch[1]))) {
      throw new ConnectorError("connector_response_invalid", "Wix did not return the updated fulfillment. Inspect the order before retrying.", { statusCode: 502 });
    }
    const productMatch = /\/(?:stores-reader\/v1|stores\/v1|stores\/v3)\/products\/([a-f0-9-]{36})$/iu.exec(new URL(address).pathname);
    if (productMatch && result?.product?.id !== productMatch[1]) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different product.", { statusCode: 502 });
    }
    const locationMatch = /\/locations\/v1\/locations\/([a-f0-9-]{36})(?:\/(?:archive|set-default))?$/iu.exec(new URL(address).pathname);
    if (locationMatch && result?.location?.id !== locationMatch[1]) throw new ConnectorError("connector_response_invalid", "Wix returned a different business location.", { statusCode: 502 });
    const collectionMatch = /^\/wix-data\/v2\/collections\/(.+)$/u.exec(new URL(address).pathname);
    if (collectionMatch && result?.collection?.id !== decodeURIComponent(collectionMatch[1])) throw new ConnectorError("connector_response_invalid", "Wix returned a different CMS collection.", { statusCode: 502 });
    if (new URL(address).pathname === "/wix-data/v2/items/query" && Array.isArray(result?.dataItems) &&
        result.dataItems.some(item => item?.dataCollectionId !== options.body.dataCollectionId)) throw new ConnectorError("connector_response_invalid", "Wix returned items from a different CMS collection.", { statusCode: 502 });
    const itemMatch = /^\/wix-data\/v2\/items\/([^/]+)$/u.exec(new URL(address).pathname);
    if (itemMatch && ["GET", "PATCH"].includes(options.method) &&
        (result?.dataItem?.id !== decodeURIComponent(itemMatch[1]) || result?.dataItem?.dataCollectionId !==
          (options.method === "GET" ? new URL(address).searchParams.get("dataCollectionId") : options.body.dataCollectionId))) {
      throw new ConnectorError("connector_response_invalid", "Wix returned a different CMS item or collection. Check write outcomes before retrying.", { statusCode: 502 });
    }
    return result;
  },
  operations: {
    "carts.create": {
      scopes: [],
      request(input, settings) {
        const { note, catalogItems } = validateSchemaPayload({ schema: cartCreateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/ecom/v2/carts", headers: { "wix-site-id": settings.siteId },
          body: { cart: { source: { channelType: "WEB" }, ...(note === undefined ? {} : { note }) }, catalogItems } };
      },
      validateResult: value => guid(value?.cart?.id) && Array.isArray(value.cart.lineItems) && value.cart.lineItems.length <= 300 &&
        value.cart.lineItems.every(item => guid(item?.id))
    },
    "carts.getCheckoutUrl": {
      scopes: [],
      request(input, settings) {
        const { cartId } = validateSchemaPayload({ schema: cartIdSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "POST", url: `https://www.wixapis.com/ecom/v2/carts/${cartId}/get-checkout-url`, headers: { "wix-site-id": settings.siteId }, body: {} };
      },
      validateResult(value) {
        if (typeof value?.checkoutUrl !== "string" || value.checkoutUrl.length > 8000 || /[\p{Cc}]/u.test(value.checkoutUrl)) return false;
        try { const url = new URL(value.checkoutUrl); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
      }
    },
    "bookings.reschedule": {
      scopes: [],
      request(input, settings) {
        const { bookingId, revision, slot, notifyParticipants, message } = validateSchemaPayload({ schema: bookingRescheduleSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        if (message !== undefined && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification before supplying a message.", { statusCode: 422 });
        if (slot.eventId !== undefined) {
          if (Object.keys(slot).length !== 1 || typeof slot.eventId !== "string" || slot.eventId.length < 36 || slot.eventId.length > 250 || /[\p{Cc}]/u.test(slot.eventId)) {
            throw new ConnectorError("connector_input_invalid", "For a class, supply only the selected eventId in slot.", { statusCode: 422 });
          }
        } else {
          let validTimeZone = false;
          try { validTimeZone = typeof slot.timezone === "string" && !!new Intl.DateTimeFormat("en", { timeZone: slot.timezone }); } catch {}
          if (!guid(slot.serviceId) || !guid(slot.scheduleId) || !localDate(slot.startDate) || !localDate(slot.endDate) || slot.startDate >= slot.endDate || !validTimeZone) {
            throw new ConnectorError("connector_input_invalid", "For an appointment, supply its service/schedule IDs, increasing local slot dates and IANA timezone. Courses cannot be rescheduled.", { statusCode: 422 });
          }
        }
        return { method: "POST", url: `https://www.wixapis.com/_api/bookings-service/v2/bookings/${bookingId}/reschedule`, headers: { "wix-site-id": settings.siteId },
          body: { revision, slot, participantNotification: { notifyParticipants, ...(message === undefined ? {} : { message }) } } };
      },
      validateResult: value => guid(value?.booking?.id) && typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) &&
        BigInt(value.booking.revision) <= 9223372036854775807n && typeof value.booking.status === "string" && value.booking.status.length > 0
    },
    "bookings.confirm": bookingConfirmationOperation("confirm"),
    "bookings.decline": bookingConfirmationOperation("decline"),
    "bookings.confirmOrDecline": bookingConfirmationOperation("confirmOrDecline"),
    "bookingServices.listAddOnGroups": {
      scopes: [],
      request(input, settings) {
        const value = validateSchemaPayload({ schema: serviceIdSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/_api/bookings/v2/services/add-on-groups/list-add-on-groups-by-service-id",
          headers: { "wix-site-id": settings.siteId }, body: value };
      },
      validateResult: value => Array.isArray(value?.addOnGroupsDetails) && value.addOnGroupsDetails.length <= 3 &&
        value.addOnGroupsDetails.every(group => guid(group?.groupId) && typeof group.groupName === "string" &&
          Number.isInteger(group.maxNumberOfAddOns) && group.maxNumberOfAddOns >= 0 &&
          Array.isArray(group.addOns) && group.addOns.length <= 7 && group.addOns.every(addOn => guid(addOn?.addOnId) && typeof addOn.name === "string"))
    },
    "bookingServices.getVariants": {
      scopes: [],
      request(input, settings) {
        const { serviceId } = validateSchemaPayload({ schema: serviceIdSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "GET", url: `https://www.wixapis.com/bookings/v1/serviceOptionsAndVariants/service_id/${serviceId}`, headers: { "wix-site-id": settings.siteId } };
      },
      validateResult(value) {
        const variants = value?.serviceVariants;
        return guid(variants?.id) && guid(variants.serviceId) &&
          Array.isArray(variants.options?.values) && variants.options.values.every(option => guid(option?.id) && typeof option.type === "string") &&
          Array.isArray(variants.variants?.values) && variants.variants.values.every(variant =>
            Array.isArray(variant?.choices) && variant.choices.every(choice => guid(choice?.optionId)));
      }
    },
    "bookingCategories.list": bookingDirectoryOperation("categories"),
    "bookingStaff.list": bookingDirectoryOperation("staff"),
    "bookingServices.setLocations": {
      scopes: [],
      request(input, settings) {
        const { serviceId, locations, removedLocationAction: action, moveToLocation, notifyParticipants, notificationMessage } = validateSchemaPayload({ schema: setServiceLocationsSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        if ((action === "MOVE_TO_LOCATION") !== (moveToLocation !== undefined)) throw new ConnectorError("connector_input_invalid", "Provide a destination only when moving future sessions.", { statusCode: 422 });
        if (notificationMessage !== undefined && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification before supplying a message.", { statusCode: 422 });
        for (const location of [...locations, ...(moveToLocation ? [moveToLocation] : [])]) {
          if (location.type === "BUSINESS" && (!location.business || location.custom) ||
              location.type === "CUSTOM" && (!location.custom || location.business || !Object.keys(location.custom.address).length) ||
              location.type === "CUSTOMER" && (location.business || location.custom)) {
            throw new ConnectorError("connector_input_invalid", "Supply the details matching each service location type.", { statusCode: 422 });
          }
        }
        return { method: "POST", url: `https://www.wixapis.com/_api/bookings/v2/services/${serviceId}/locations`, headers: { "wix-site-id": settings.siteId }, body: {
          locations, removedLocationSessionsAction: { action, ...(moveToLocation ? { moveToLocationOptions: { newLocation: moveToLocation } } : {}) },
          participantNotification: { notifyParticipants, ...(notificationMessage !== undefined ? { message: notificationMessage } : {}) }
        } };
      },
      validateResult: value => validService(value?.service)
    },
    "bookingServices.create": {
      scopes: [],
      request(input, settings) {
        const { service } = validateSchemaPayload({ schema: serviceCreateSchema, mode: "replace" }, input, { statusCode: 422 });
        const invalid = message => { throw new ConnectorError("connector_input_invalid", message, { statusCode: 422 }); };
        if (!guid(settings.siteId)) invalid("Configure the Wix Site ID first.");
        if (!["APPOINTMENT", "CLASS", "COURSE"].includes(service.type) || typeof service.name !== "string" || !service.name.trim() || service.name.length > 400) invalid("Provide a service type and name of up to 400 characters.");
        if (["id", "revision", "createdByAppId", "createdDate", "updatedDate", "addOnGroups"].some(key => Object.hasOwn(service, key))) invalid("Do not send generated service identity fields or existing add-on groups when creating a service.");
        if (!Number.isInteger(service.defaultCapacity) || service.defaultCapacity < 1 || service.defaultCapacity > 1000 || service.type === "APPOINTMENT" && service.defaultCapacity !== 1) invalid("Set appointment capacity to 1, or class/course capacity from 1 to 1000.");
        const online = service.onlineBooking;
        if (!online || typeof online.enabled !== "boolean" || ["requireManualApproval", "allowMultipleRequests"].some(key => online[key] !== undefined && typeof online[key] !== "boolean")) invalid("Provide explicit online-booking settings.");
        const payment = service.payment;
        if (!payment || !["FIXED", "VARIED", "CUSTOM", "NO_FEE"].includes(payment.rateType)) invalid("Use FIXED, VARIED, CUSTOM or NO_FEE service payment settings.");
        const options = payment.options;
        if (!options || typeof options !== "object" || ["online", "inPerson", "deposit", "pricingPlan"].some(key => options[key] !== undefined && typeof options[key] !== "boolean") || !(options.online === true || options.inPerson === true)) invalid("Select in-person or online payment, including for a free service.");
        if (online.requireManualApproval && options.pricingPlan || !online.enabled && options.online) invalid("Manual approval cannot use pricing plans; online payment requires online booking.");
        const priced = ["FIXED", "VARIED"].includes(payment.rateType);
        if ((options.online || options.deposit) && !priced) invalid("Online and deposit payments require fixed or varied pricing.");
        const rate = payment.rateType === "FIXED" ? payment.fixed : payment.varied;
        const money = value => value && typeof value.value === "string" && value.value.length <= 30 && /^\d+(?:\.\d{1,2})?$/u.test(value.value) && /[1-9]/u.test(value.value) && /^[A-Z]{3}$/u.test(value.currency);
        if (priced && !money(payment.rateType === "FIXED" ? rate?.price : rate?.defaultPrice)) invalid("Provide a positive decimal price string and three-letter currency code.");
        if (payment.rateType === "CUSTOM" && (typeof payment.custom?.description !== "string" || !payment.custom.description.length || payment.custom.description.length > 50)) invalid("Describe the custom payment in up to 50 characters.");
        if (options.deposit && (!options.online || options.inPerson || !money(rate?.deposit))) invalid("A deposit requires its amount, online payment and no in-person payment.");
        const durations = service.schedule?.availabilityConstraints?.sessionDurations;
        if (service.type === "APPOINTMENT") {
          if (!Array.isArray(service.staffMemberIds) || !service.staffMemberIds.length || !service.staffMemberIds.every(guid)) invalid("Select at least one staff resource ID for the appointment service.");
          if (!Array.isArray(durations) || !durations.length || !durations.every(value => Number.isInteger(value) && value > 0)) invalid("Provide appointment session durations in minutes.");
        } else if (durations !== undefined) invalid("Class/course session durations belong to their sessions, not service availability constraints.");
        return { method: "POST", url: "https://www.wixapis.com/_api/bookings/v2/services", headers: { "wix-site-id": settings.siteId }, body: { service } };
      },
      validateResult: value => validService(value?.service)
    },
    "cmsItems.get": {
      scopes: [],
      request(input, settings) {
        const { collectionId: dataCollectionId, itemId, consistentRead } = validateSchemaPayload({ schema: cmsItemGetSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        const url = new URL(`https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(itemId)}`);
        url.searchParams.set("dataCollectionId", dataCollectionId); url.searchParams.set("consistentRead", String(consistentRead));
        return { method: "GET", url: url.href, headers: { "wix-site-id": settings.siteId } };
      },
      validateResult: value => value?.dataItem?.data && typeof value.dataItem.data === "object" && !Array.isArray(value.dataItem.data)
    },
    "cmsItems.patch": {
      scopes: [],
      request(input, settings) {
        const { collectionId: dataCollectionId, itemId, fieldModifications, conditionFilter } = validateSchemaPayload({ schema: cmsItemPatchSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "PATCH", url: `https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(itemId)}`, headers: { "wix-site-id": settings.siteId },
          body: { dataCollectionId, patch: { dataItemId: itemId, fieldModifications }, ...(conditionFilter !== undefined ? { condition: { filter: conditionFilter } } : {}) } };
      },
      validateResult: value => value?.dataItem?.data && typeof value.dataItem.data === "object" && !Array.isArray(value.dataItem.data)
    },
    "cmsItems.list": {
      scopes: [],
      request(input, settings) {
        const { collectionId: dataCollectionId, consistentRead, filter, sort, fields, returnTotalCount, includeReferences, ...paging } = validateSchemaPayload({ schema: cmsItemQuerySchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/wix-data/v2/items/query", headers: { "wix-site-id": settings.siteId },
          body: { dataCollectionId, consistentRead,
            ...(returnTotalCount !== undefined ? { returnTotalCount } : {}), ...(includeReferences !== undefined ? { includeReferences } : {}),
            query: { paging, ...(filter !== undefined ? { filter } : {}), ...(sort !== undefined ? { sort } : {}), ...(fields !== undefined ? { fields } : {}) } } };
      },
      validateResult: value => Array.isArray(value?.dataItems) && value.dataItems.length <= 100 && value.dataItems.every(item =>
        typeof item?.id === "string" && item.id.length > 0 && collectionId(item.dataCollectionId) && item.data && typeof item.data === "object" && !Array.isArray(item.data)) &&
        (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata))
    },
    "cmsCollections.list": {
      scopes: [],
      request(input, settings) {
        const value = validateSchemaPayload({ schema: collectionListSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        const url = new URL("https://www.wixapis.com/wix-data/v2/collections");
        url.searchParams.set("paging.limit", String(value.limit)); url.searchParams.set("paging.offset", String(value.offset));
        url.searchParams.set("consistentRead", String(value.consistentRead));
        return { method: "GET", url: url.href, headers: { "wix-site-id": settings.siteId } };
      },
      validateResult: value => Array.isArray(value?.collections) && value.collections.length <= 100 && value.collections.every(validCollection) &&
        (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata))
    },
    "cmsCollections.get": {
      scopes: [],
      request(input, settings) {
        const value = validateSchemaPayload({ schema: collectionGetSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        const id = value.collectionId.split("/").map(encodeURIComponent).join("/");
        return { method: "GET", url: `https://www.wixapis.com/wix-data/v2/collections/${id}?consistentRead=${value.consistentRead}`, headers: { "wix-site-id": settings.siteId } };
      },
      validateResult: value => validCollection(value?.collection)
    },
    "locations.archive": locationActionOperation("archive"),
    "locations.setDefault": locationActionOperation("set-default"),
    "locations.create": locationWriteOperation("create"),
    "locations.update": locationWriteOperation("update"),
    "locations.list": {
      scopes: [],
      request(input, settings) {
        const { archived, ...paging } = validateSchemaPayload({ schema: locationQuerySchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/locations/v1/locations/query", headers: { "wix-site-id": settings.siteId },
          body: { query: { filter: { archived }, paging }, filterAuthorizedLocationEntities: true } };
      },
      validateResult: value => Array.isArray(value?.locations) && value.locations.length <= 100 && value.locations.every(validLocation) &&
        (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata) &&
          ["count", "offset", "total"].every(key => value.pagingMetadata[key] === undefined || Number.isSafeInteger(value.pagingMetadata[key]) && value.pagingMetadata[key] >= 0))
    },
    "locations.get": {
      scopes: [],
      request(input, settings) {
        const { locationId } = validateSchemaPayload({ schema: locationGetSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "GET", url: `https://www.wixapis.com/locations/v1/locations/${locationId}`, headers: { "wix-site-id": settings.siteId } };
      },
      validateResult: value => validLocation(value?.location)
    },
    "productsV1.list": productReadOperation(1, "list"),
    "productsV1.get": productReadOperation(1, "get"),
    "productsV1.update": {
      scopes: [],
      request(input, settings) {
        const { productId, price, ...changes } = validateSchemaPayload({ schema: productV1UpdateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        if (!Object.keys(changes).length && price === undefined) throw new ConnectorError("connector_input_invalid", "Provide a product name, visibility or base-price change.", { statusCode: 422 });
        return { method: "PATCH", url: `https://www.wixapis.com/stores/v1/products/${productId}`,
          headers: { "wix-site-id": settings.siteId }, body: { product: { ...changes, ...(price === undefined ? {} : { priceData: { price } }) } } };
      },
      validateResult: value => guid(value?.product?.id) && typeof value.product.name === "string" && value.product.name.length > 0
    },
    "productsV3.list": productReadOperation(3, "list"),
    "productsV3.get": productReadOperation(3, "get"),
    "productsV3.update": {
      scopes: [],
      request(input, settings) {
        const { productId, revision, ...changes } = validateSchemaPayload({ schema: productV3UpdateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        if (!Object.keys(changes).length) throw new ConnectorError("connector_input_invalid", "Provide a product name or visibility change.", { statusCode: 422 });
        return { method: "PATCH", url: `https://www.wixapis.com/stores/v3/products/${productId}`,
          headers: { "wix-site-id": settings.siteId }, body: { product: { id: productId, revision, ...changes } } };
      },
      validateResult: value => guid(value?.product?.id) && typeof value.product.name === "string" && value.product.name.length > 0 &&
        typeof value.product.revision === "string" && /^\d{1,19}$/u.test(value.product.revision) && BigInt(value.product.revision) <= 9223372036854775807n
    },
    "catalog.version": {
      scopes: [],
      request(input, settings) {
        validateSchemaPayload({ schema: catalogVersionSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "GET", url: "https://www.wixapis.com/stores/v3/provision/version", headers: { "wix-site-id": settings.siteId } };
      }, validateResult: value => ["V1_CATALOG", "V3_CATALOG", "STORES_NOT_INSTALLED"].includes(value?.catalogVersion)
    },
    "orders.list": {
      scopes: [],
      request(input, settings) {
        const { status, contactId, ...cursorPaging } = validateSchemaPayload({ schema: orderSearchSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        if (cursorPaging.cursor && (status || contactId)) throw new ConnectorError("connector_input_invalid", "Use only cursor and limit for the next order page.", { statusCode: 422 });
        const filter = { ...(status ? { status } : {}), ...(contactId ? { "buyerInfo.contactId": contactId } : {}) };
        return { method: "POST", url: "https://www.wixapis.com/ecom/v1/orders/search", headers: { "wix-site-id": settings.siteId },
          body: { search: { cursorPaging, ...(Object.keys(filter).length ? { filter } : {}) } } };
      },
      validateResult: value => Array.isArray(value?.orders) && value.orders.length <= 100 && value.orders.every(validOrder) &&
        (value.metadata === undefined || value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) &&
          (value.metadata.count === undefined || value.metadata.count === value.orders.length) &&
          (value.metadata.hasNext === undefined || typeof value.metadata.hasNext === "boolean") &&
          (value.metadata.cursors === undefined || value.metadata.cursors && typeof value.metadata.cursors === "object" && !Array.isArray(value.metadata.cursors) &&
            ["next", "prev"].every(key => value.metadata.cursors[key] === undefined || cursor(value.metadata.cursors[key]))))
    },
    "orders.get": {
      scopes: [],
      request(input, settings) {
        const { orderId } = validateSchemaPayload({ schema: orderIdSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "GET", url: `https://www.wixapis.com/ecom/v1/orders/${encodeURIComponent(orderId)}`, headers: { "wix-site-id": settings.siteId } };
      }, validateResult: value => validOrder(value?.order)
    },
    "orderFulfillments.create": fulfillmentWriteOperation(false),
    "orderFulfillments.update": fulfillmentWriteOperation(true),
    "orderFulfillments.list": {
      scopes: [],
      request(input, settings) {
        const { orderId } = validateSchemaPayload({ schema: orderIdSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "GET", url: `https://www.wixapis.com/ecom/v1/fulfillments/orders/${encodeURIComponent(orderId)}`, headers: { "wix-site-id": settings.siteId } };
      },
      validateResult: value => guid(value?.orderWithFulfillments?.orderId) && Array.isArray(value.orderWithFulfillments.fulfillments) &&
        value.orderWithFulfillments.fulfillments.every(item => guid(item?.id) && Array.isArray(item.lineItems) && item.lineItems.length <= 300 &&
          item.lineItems.every(line => guid(line?.id) && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 100000))
    },
    "classAvailability.list": availabilityOperation("list", true),
    "classAvailability.get": {
      scopes: [],
      request(input, settings) {
        const { eventId, timeZone } = validateSchemaPayload({ schema: eventSlotSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        const url = new URL(`https://www.wixapis.com/_api/service-availability/v2/time-slots/event/${encodeURIComponent(eventId)}`);
        url.searchParams.set("timeZone", timeZone);
        return { method: "GET", url: url.href, headers: { "wix-site-id": settings.siteId } };
      }, validateResult: value => validSlot(value?.timeSlot) && typeof value.timeSlot.eventInfo?.eventId === "string" && typeof value.timeZone === "string"
    },
    "forms.summary": {
      scopes: [],
      request(input, settings) {
        const { formId } = validateSchemaPayload({ schema: formSummarySchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "GET", url: `https://www.wixapis.com/form-schema-service/v4/forms/${formId}/summary`, headers: { "wix-site-id": settings.siteId } };
      },
      validateResult: value => guid(value?.formSummary?.id) && Array.isArray(value.formSummary.fields) && value.formSummary.fields.length <= 500 &&
        value.formSummary.fields.every(field => guid(field?.id) && typeof field.target === "string" && field.target.length > 0 && field.target.length <= 200 &&
          typeof field.type === "string" && field.type.length > 0 && (field.label === undefined || typeof field.label === "string" && field.label.length <= 350) &&
          (field.deleted === undefined || typeof field.deleted === "boolean") && (field.options === undefined || Array.isArray(field.options) && field.options.length <= 400))
    },
    "bookings.create": {
      scopes: [],
      request(input, settings) {
        const value = validateSchemaPayload({ schema: bookingCreateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        const { kind, serviceId, timeZone, startDate, endDate, eventId, scheduleId, resourceId, location, totalParticipants, participantsChoices, bookedAddOns, formSubmission, notifyParticipants, sendSmsReminder } = value;
        if (participantsChoices) {
          if (totalParticipants !== undefined) throw new ConnectorError("connector_input_invalid", "Use participant choices or a fixed participant total, not both.", { statusCode: 422 });
          if (participantsChoices.serviceChoices.reduce((total, group) => total + group.numberOfParticipants, 0) > 1000 ||
              participantsChoices.serviceChoices.some(group => new Set(group.choices.map(choice => choice.optionId)).size !== group.choices.length ||
                group.choices.some(choice => (choice.custom !== undefined) === (choice.duration !== undefined)))) {
            throw new ConnectorError("connector_input_invalid", "Use at most 1000 participants, distinct options per group and exactly one custom or duration value per choice.", { statusCode: 422 });
          }
        }
        if (kind === "APPOINTMENT" ? !startDate || !endDate || startDate >= endDate || !resourceId || !location || eventId || scheduleId :
            kind === "CLASS" ? !eventId || startDate || endDate || resourceId || location || scheduleId : !scheduleId || startDate || endDate || resourceId || location || eventId) {
          throw new ConnectorError("connector_input_invalid", "Use appointment dates/resource/location, a class event ID, or a course schedule ID, matching the selected service type.", { statusCode: 422 });
        }
        if (location?.locationType === "OWNER_BUSINESS" && !location.id) throw new ConnectorError("connector_input_invalid", "Choose the business location ID.", { statusCode: 422 });
        const bookedEntity = kind === "COURSE" ? { schedule: { scheduleId, serviceId, timezone: timeZone } } :
          { slot: { serviceId, timezone: timeZone, ...(kind === "CLASS" ? { eventId } : { startDate, endDate, resource: { id: resourceId }, location }) } };
        return { method: "POST", url: "https://www.wixapis.com/_api/bookings-service/v2/bookings", headers: { "wix-site-id": settings.siteId },
          body: { booking: { bookedEntity, ...(participantsChoices ? { participantsChoices } : { totalParticipants: totalParticipants ?? 1 }),
            ...(bookedAddOns ? { bookedAddOns } : {}) }, formSubmission, participantNotification: { notifyParticipants }, sendSmsReminder } };
      },
      validateResult: value => guid(value?.booking?.id) && typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) &&
        BigInt(value.booking.revision) <= 9223372036854775807n && typeof value.booking.status === "string" && value.booking.status.length > 0
    },
    "availability.list": availabilityOperation("list"),
    "availability.get": availabilityOperation("get"),
    "bookings.list": {
      scopes: [],
      request(input, settings) {
        const { bookingId, ...paging } = validateSchemaPayload({ schema: bookingQuerySchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/_api/bookings-reader/v2/extended-bookings/query",
          headers: { "wix-site-id": settings.siteId }, body: { query: { paging, ...(bookingId ? { filter: { id: bookingId } } : {}) }, withBookingAllowedActions: true } };
      },
      validateResult: value => Array.isArray(value?.extendedBookings) && value.extendedBookings.length <= 100 && value.extendedBookings.every(record =>
        guid(record?.booking?.id) && typeof record.booking.revision === "string" && /^\d{1,19}$/u.test(record.booking.revision) && BigInt(record.booking.revision) <= 9223372036854775807n &&
        typeof record.booking.status === "string" && record.booking.status.length > 0 &&
        (record.allowedActions === undefined || record.allowedActions && typeof record.allowedActions === "object" && !Array.isArray(record.allowedActions) &&
          ["cancel", "reschedule"].every(key => record.allowedActions[key] === undefined || typeof record.allowedActions[key] === "boolean"))) &&
        (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata) &&
          ["count", "offset", "total"].every(key => value.pagingMetadata[key] === undefined || Number.isSafeInteger(value.pagingMetadata[key]) && value.pagingMetadata[key] >= 0) &&
          (value.pagingMetadata.count === undefined || value.pagingMetadata.count === value.extendedBookings.length))
    },
    "bookings.cancel": {
      scopes: [],
      request(input, settings) {
        const { bookingId, revision, notifyParticipants, message, waiveCharges } = validateSchemaPayload({ schema: bookingCancelSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        if (message && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification to send a cancellation message.", { statusCode: 422 });
        return { method: "POST", url: `https://www.wixapis.com/_api/bookings-service/v2/bookings/${bookingId}/cancel`,
          headers: { "wix-site-id": settings.siteId }, body: { revision, waiveCharges,
            participantNotification: { notifyParticipants, ...(message === undefined ? {} : { message }) } } };
      },
      validateResult: value => guid(value?.booking?.id) && value.booking.status === "CANCELED" &&
        typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) && BigInt(value.booking.revision) <= 9223372036854775807n
    },
    "bookingServices.list": {
      scopes: [],
      request(input, settings) {
        const paging = validateSchemaPayload({ schema: servicePagingSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/_api/bookings/v2/services/query", headers: { "wix-site-id": settings.siteId }, body: { query: { paging } } };
      },
      validateResult: value => Array.isArray(value?.services) && value.services.length <= 100 && value.services.every(validService) &&
        (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata) &&
          ["count", "offset", "total"].every(key => value.pagingMetadata[key] === undefined || Number.isSafeInteger(value.pagingMetadata[key]) && value.pagingMetadata[key] >= 0) &&
          (value.pagingMetadata.count === undefined || value.pagingMetadata.count === value.services.length))
    },
    "bookingServices.get": {
      scopes: [],
      request(input, settings) {
        const { serviceId } = validateSchemaPayload({ schema: serviceIdSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        return { method: "GET", url: `https://www.wixapis.com/_api/bookings/v2/services/${serviceId}`, headers: { "wix-site-id": settings.siteId } };
      }, validateResult: value => validService(value?.service)
    },
    "bookingServices.update": {
      scopes: [],
      request(input, settings) {
        const { serviceId, ...service } = validateSchemaPayload({ schema: serviceUpdateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422 });
        if (Object.keys(service).length < 2) throw new ConnectorError("connector_input_invalid", "Choose a service field to update.", { statusCode: 422 });
        if (["payment", "onlineBooking"].some(key => service[key] !== undefined && !Object.keys(service[key]).length) ||
            service.schedule && !Object.keys(service.schedule.availabilityConstraints).length) {
          throw new ConnectorError("connector_input_invalid", "Provide the selected service settings instead of an empty object.", { statusCode: 422 });
        }
        return { method: "PATCH", url: `https://www.wixapis.com/_api/bookings/v2/services/${serviceId}`, headers: { "wix-site-id": settings.siteId }, body: { service: { id: serviceId, ...service } } };
      }, validateResult: value => validService(value?.service)
    },
    "contacts.get": contactOperation("get"),
    "contacts.create": contactOperation("create"),
    "contacts.update": contactOperation("update"),
    "contacts.list": {
      scopes: [],
      request(input, settings) {
        const { search, ...paging } = validateSchemaPayload({ schema: contactsSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!guid(settings.siteId)) throw new ConnectorError("connector_input_invalid", "Configure the project's Wix Site ID before querying contacts.", { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/contacts/v4/contacts/query",
          headers: { "wix-site-id": settings.siteId },
          body: { query: { paging }, ...(search === undefined ? {} : { search }) } };
      },
      validateResult: value => Array.isArray(value?.contacts) && value.contacts.length <= 100 &&
        value.contacts.every(contact => guid(contact?.id) && (contact.info === undefined || contact.info && typeof contact.info === "object" && !Array.isArray(contact.info))) &&
        (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata) &&
          ["count", "offset", "total"].every(key => value.pagingMetadata[key] === undefined || Number.isSafeInteger(value.pagingMetadata[key]) && value.pagingMetadata[key] >= 0) &&
          (value.pagingMetadata.count === undefined || value.pagingMetadata.count === value.contacts.length))
    },
    "sites.list": {
      scopes: [],
      request(input) {
        const paging = validateSchemaPayload({ schema: querySchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/site-list/v2/sites/query", body: { query: { cursorPaging: paging } } };
      },
      validateResult: (value) => Array.isArray(value?.sites) && value.sites.length <= 100 && value.sites.every((site) => guid(site?.id) &&
        ["name", "displayName", "viewUrl", "editUrl", "thumbnail"].every((key) => site[key] === undefined || typeof site[key] === "string") &&
        ["published", "premium", "domainConnected"].every((key) => site[key] === undefined || typeof site[key] === "boolean")) &&
        (value.metadata === undefined || value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) &&
          (value.metadata.count === undefined || Number.isSafeInteger(value.metadata.count) && value.metadata.count === value.sites.length) &&
          (value.metadata.cursors === undefined || value.metadata.cursors && typeof value.metadata.cursors === "object" && !Array.isArray(value.metadata.cursors) &&
            ["next", "prev"].every((key) => value.metadata.cursors[key] === undefined || cursor(value.metadata.cursors[key]))))
    }
  }
 };
function wixSiteOperation(operation) {
  return {
    ...operation,
    request(input, settings) {
      if (!input || !Object.hasOwn(input, "siteId")) return operation.request(input, settings);
      const { siteId, ...values } = input;
      if (!guid(siteId)) throw new ConnectorError("connector_input_invalid", "Choose a valid Wix Site ID.", { statusCode: 422 });
      const allowed = (settings.selectableSiteIds || "").split(",").map(id => id.trim().toLowerCase());
      if (!allowed.includes(siteId.toLowerCase())) throw new ConnectorError("connector_input_invalid", "This site is not enabled in the project's Selectable Site IDs.", { statusCode: 422 });
      return operation.request(values, { ...settings, siteId });
    }
  };
}
const wixProvider = Object.freeze({ ...wixRuntime,
  operations: Object.fromEntries(Object.entries(wixRuntime.operations).map(([name, operation]) =>
    [name, name === "sites.list" ? operation : wixSiteOperation(operation)]))
});
export { wixProvider };
