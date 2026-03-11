import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { contactsResource } from "../../shared/contacts/contactsResource.js";

function createContactForm() {
  return {
    name: "",
    surname: ""
  };
}

function assignContactToForm(model, payload = {}) {
  model.name = String(payload?.name || "");
  model.surname = String(payload?.surname || "");
}

function buildContactPayload(model) {
  return {
    name: model.name,
    surname: model.surname
  };
}

function parseCreateContactInput(rawPayload) {
  return validateOperationSection({
    operation: contactsResource.operations.create,
    section: "body",
    value: rawPayload
  });
}

function parsePatchContactInput(rawPayload) {
  return validateOperationSection({
    operation: contactsResource.operations.patch,
    section: "body",
    value: rawPayload
  });
}

function contactsListQueryKey(surfaceId = "") {
  return ["crud", "contacts", "list", normalizeQueryToken(surfaceId)];
}

function contactViewQueryKey(surfaceId = "", contactId = 0) {
  return ["crud", "contacts", "view", normalizeQueryToken(surfaceId), Number(contactId) || 0];
}

function resolveAdminContactsListPath() {
  return "/admin/contacts";
}

function resolveAdminContactNewPath() {
  return "/admin/contacts/new";
}

function resolveAdminContactViewPath(contactIdLike) {
  const contactId = Number(contactIdLike);
  if (!Number.isInteger(contactId) || contactId < 1) {
    return "";
  }

  return `/admin/contacts/${contactId}`;
}

function resolveAdminContactEditPath(contactIdLike) {
  const detailPath = resolveAdminContactViewPath(contactIdLike);
  return detailPath ? `${detailPath}/edit` : "";
}

function toRouteContactId(value) {
  if (Array.isArray(value)) {
    return toRouteContactId(value[0]);
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export {
  contactsResource,
  createContactForm,
  assignContactToForm,
  buildContactPayload,
  parseCreateContactInput,
  parsePatchContactInput,
  contactsListQueryKey,
  contactViewQueryKey,
  resolveAdminContactsListPath,
  resolveAdminContactNewPath,
  resolveAdminContactViewPath,
  resolveAdminContactEditPath,
  toRouteContactId
};
