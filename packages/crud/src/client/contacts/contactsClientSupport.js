import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceAwareMenuTarget } from "@jskit-ai/users-web/client/lib/workspaceMenuTarget";
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

function resolveAdminContactsListPath(context = null, workspaceSlug = "") {
  return resolveWorkspaceAwareMenuTarget({
    context,
    surface: "admin",
    workspaceSlug,
    workspaceSuffix: "/contacts",
    nonWorkspaceSuffix: "/contacts"
  });
}

function resolveAdminContactNewPath(context = null, workspaceSlug = "") {
  return resolveWorkspaceAwareMenuTarget({
    context,
    surface: "admin",
    workspaceSlug,
    workspaceSuffix: "/contacts/new",
    nonWorkspaceSuffix: "/contacts/new"
  });
}

function resolveAdminContactViewPath(contactIdLike, context = null, workspaceSlug = "") {
  const contactId = Number(contactIdLike);
  if (!Number.isInteger(contactId) || contactId < 1) {
    return "";
  }

  return resolveWorkspaceAwareMenuTarget({
    context,
    surface: "admin",
    workspaceSlug,
    workspaceSuffix: `/contacts/${contactId}`,
    nonWorkspaceSuffix: `/contacts/${contactId}`
  });
}

function resolveAdminContactEditPath(contactIdLike, context = null, workspaceSlug = "") {
  const contactId = Number(contactIdLike);
  if (!Number.isInteger(contactId) || contactId < 1) {
    return "";
  }

  return resolveWorkspaceAwareMenuTarget({
    context,
    surface: "admin",
    workspaceSlug,
    workspaceSuffix: `/contacts/${contactId}/edit`,
    nonWorkspaceSuffix: `/contacts/${contactId}/edit`
  });
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
