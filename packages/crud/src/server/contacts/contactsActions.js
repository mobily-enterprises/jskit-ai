import { requireAuthenticated } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { contactsInputPartsValidator } from "./contactsInputPartsValidator.js";
import { contactsResource } from "../../shared/contacts/contactsResource.js";

const contactsActions = Object.freeze([
  {
    id: "contacts.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    input: [contactsInputPartsValidator.workspaceParams, contactsInputPartsValidator.listQuery],
    output: contactsResource.operations.list.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "contacts.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.listContacts(input, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "contacts.view",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    input: contactsInputPartsValidator.routeParams,
    output: contactsResource.operations.view.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "contacts.view"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.getContact(input.contactId, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "contacts.create",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    input: [contactsInputPartsValidator.workspaceParams, contactsResource.operations.create.body],
    output: contactsResource.operations.create.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "contacts.create"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.createContact(input, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "contacts.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    input: [contactsInputPartsValidator.routeParams, contactsResource.operations.patch.body],
    output: contactsResource.operations.patch.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "contacts.update"
    },
    observability: {},
    async execute(input, context, deps) {
      const { contactId, ...patch } = input;
      return deps.contactsService.updateContact(contactId, patch, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "contacts.delete",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    input: contactsInputPartsValidator.routeParams,
    output: contactsResource.operations.delete.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "contacts.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.contactsService.deleteContact(input.contactId, {
        visibilityContext: context?.visibilityContext
      });
    }
  }
]);

export { contactsActions };
