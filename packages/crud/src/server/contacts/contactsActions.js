import { requireAuthenticated } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { contactsInputParts } from "./contactsInputParts.js";
import { contactsSchema } from "../../shared/contacts/contactsSchema.js";

const contactsActions = Object.freeze([
  {
    id: "contacts.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    visibility: "public",
    input: contactsInputParts.listQuery,
    output: contactsSchema.operations.list.output,
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
    output: contactsSchema.operations.view.output,
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
    input: contactsSchema.operations.create.body,
    output: contactsSchema.operations.create.output,
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
    input: [contactsInputParts.routeParams, contactsSchema.operations.patch.body],
    output: contactsSchema.operations.patch.output,
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
    output: contactsSchema.operations.delete.output,
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
