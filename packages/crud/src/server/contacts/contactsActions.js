import { requireAuthenticated } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { contactsInputParts } from "./contactsInputParts.js";
import { contactsResource } from "../../shared/contacts/contactsResource.js";

const contactsActions = Object.freeze([
  {
    id: "contacts.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    visibility: "public",
    input: contactsInputParts.listQuery,
    output: contactsResource.operations.list.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "contacts.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.listContacts(input);
    }
  },
  {
    id: "contacts.view",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    visibility: "public",
    input: contactsInputParts.routeParams,
    output: contactsResource.operations.view.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "contacts.view"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.getContact(input.contactId);
    }
  },
  {
    id: "contacts.create",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    visibility: "public",
    input: contactsResource.operations.create.body,
    output: contactsResource.operations.create.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "contacts.create"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.createContact(input);
    }
  },
  {
    id: "contacts.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    visibility: "public",
    input: [contactsInputParts.routeParams, contactsResource.operations.patch.body],
    output: contactsResource.operations.patch.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "contacts.update"
    },
    observability: {},
    async execute(input, context, deps) {
      const { contactId, ...patch } = input;
      return deps.contactsService.updateContact(contactId, patch);
    }
  },
  {
    id: "contacts.delete",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    visibility: "public",
    input: contactsInputParts.routeParams,
    output: contactsResource.operations.delete.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "contacts.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.deleteContact(input.contactId);
    }
  }
]);

export { contactsActions };
