import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { requestPath, sameRecord, cursor, querySchema, contactIdField } from "./wixValues.js";
import { wixDefinition } from "../shared/wix.js";
import { wixBookingOperations } from "./wixBookings.js";
import { wixCmsOperations } from "./wixCms.js";
import { wixStoreOperations } from "./wixStores.js";
import { isUuid } from "./connectorValues.js";

// The Wix provider: its API-key headers, site addressing and the site and contact
// operations. The Bookings, eCommerce and Stores, and CMS operations live beside it.
const contactsSchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 },
  search: { type: "string", minLength: 1, maxLength: 100 }
});
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
const validContact = value => isUuid(value?.id) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
  value.info && typeof value.info === "object" && !Array.isArray(value.info);
function contactOperation(action) {
  const fields = action === "get" ? { contactId: contactIdField } : {
    ...(action === "update" ? { contactId: contactIdField, revision: { type: "integer", required: true, min: 0, max: 2147483647 } } : {}),
    info: { type: "object", required: true, schema: contactInfoSchema }, allowDuplicates: { type: "boolean", defaultTo: false }
  };
  const schema = createSchema(fields);
  return {
    scopes: [],
    request(input) {
      const { contactId, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (action !== "get" && (!Object.keys(body.info).length || (action === "create" &&
          !(body.info.name?.first || body.info.name?.last || body.info.emails?.items?.length || body.info.phones?.items?.length)))) {
        throw new ConnectorError("connector_input_invalid", "Provide contact details; creation requires a name, email or phone.", { statusCode: 422, messageCode: "connectors.wix.provideContactDetailsCreationRequires" });
      }
      return { method: action === "get" ? "GET" : action === "create" ? "POST" : "PATCH",
        url: `https://www.wixapis.com/contacts/v4/contacts${contactId ? `/${contactId}` : ""}`,
        ...(action === "get" ? {} : { body }) };
    },
    validateResult: (value, request) => validContact(value?.contact) && (action === "create" ||
      sameRecord(value.contact.id === requestPath(request, -1), "Wix returned a different contact. Check the operation outcome before retrying.", { messageCode: "connectors.wix.returnedDifferentContactCheckOperation" }))
  };
}
const wixRuntime = {
  ...wixDefinition, apiOrigins: ["https://www.wixapis.com"],
  apiKey: { headers: (key, settings) => ({ Authorization: key, "wix-account-id": settings.accountId }) },
  checkOperation: "sites.list",
  // Site-scoped calls authenticate by site, so the account header is dropped when a site is addressed.
  async exchange(address, options, { request }) {
    const headers = { ...options.headers };
    if (headers["wix-site-id"]) delete headers["wix-account-id"];
    return request(address, { ...options, headers });
  },
  operations: {
    ...wixStoreOperations,
    ...wixBookingOperations,
    ...wixCmsOperations,
    "contacts.get": contactOperation("get"),
    "contacts.create": contactOperation("create"),
    "contacts.update": contactOperation("update"),
    "contacts.list": {
      scopes: [],
      request(input) {
        const { search, ...paging } = validateSchemaPayload({ schema: contactsSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: "https://www.wixapis.com/contacts/v4/contacts/query",
          body: { query: { paging }, ...(search === undefined ? {} : { search }) } };
      },
      validateResult: value => Array.isArray(value?.contacts) && value.contacts.length <= 100 &&
        value.contacts.every(contact => isUuid(contact?.id) && (contact.info === undefined || contact.info && typeof contact.info === "object" && !Array.isArray(contact.info))) &&
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
      validateResult: (value) => Array.isArray(value?.sites) && value.sites.length <= 100 && value.sites.every((site) => isUuid(site?.id) &&
        ["name", "displayName", "viewUrl", "editUrl", "thumbnail"].every((key) => site[key] === undefined || typeof site[key] === "string") &&
        ["published", "premium", "domainConnected"].every((key) => site[key] === undefined || typeof site[key] === "boolean")) &&
        (value.metadata === undefined || value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) &&
          (value.metadata.count === undefined || Number.isSafeInteger(value.metadata.count) && value.metadata.count === value.sites.length) &&
          (value.metadata.cursors === undefined || value.metadata.cursors && typeof value.metadata.cursors === "object" && !Array.isArray(value.metadata.cursors) &&
            ["next", "prev"].every((key) => value.metadata.cursors[key] === undefined || cursor(value.metadata.cursors[key]))))
    }
  }
 };
// Every operation except sites.list addresses one site: this resolves it, requires it and sends it.
function wixSiteOperation(operation) {
  return {
    ...operation,
    request(input, settings) {
      let siteId = settings.siteId, values = input;
      if (input && Object.hasOwn(input, "siteId")) {
        ({ siteId, ...values } = input);
        if (!isUuid(siteId)) throw new ConnectorError("connector_input_invalid", "Choose a valid Wix Site ID.", { statusCode: 422, messageCode: "connectors.wix.chooseValidSiteId" });
        const allowed = (settings.selectableSiteIds || "").split(",").map(id => id.trim().toLowerCase());
        if (!allowed.includes(siteId.toLowerCase())) throw new ConnectorError("connector_input_invalid", "This site is not enabled in the project's Selectable Site IDs.", { statusCode: 422, messageCode: "connectors.wix.siteNotEnabledProjectSelectable" });
      } else if (!isUuid(siteId)) throw new ConnectorError("connector_input_invalid", "Configure the Wix Site ID first.", { statusCode: 422, messageCode: "connectors.wix.configureSiteIdFirst" });
      const request = operation.request(values, { ...settings, siteId });
      return { ...request, headers: { ...request.headers, "wix-site-id": siteId } };
    }
  };
}
const wixProvider = Object.freeze({ ...wixRuntime,
  operations: Object.fromEntries(Object.entries(wixRuntime.operations).map(([name, operation]) =>
    [name, name === "sites.list" ? operation : wixSiteOperation(operation)]))
});
export { wixProvider };
