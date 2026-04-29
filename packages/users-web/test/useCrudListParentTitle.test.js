import assert from "node:assert/strict";
import test from "node:test";
import { resolveCrudListParentDescriptor, resolveCrudListParentRecordTitle, resolveCrudListParentTitleFromItems } from "../src/client/composables/internal/crudListParentTitleSupport.js";

const contactChildResource = Object.freeze({
  contract: {
    lookup: {
      containerKey: "lookups"
    }
  },
  operations: {
    view: {
      output: {
        schema: {
          type: "object",
          properties: {
            contactId: {
              type: "integer",
              relation: {
                kind: "lookup",
                namespace: "contacts",
                valueKey: "id"
              }
            },
            serviceId: {
              type: "integer",
              relation: {
                kind: "lookup",
                namespace: "services",
                valueKey: "id"
              }
            }
          }
        }
      }
    }
  }
});

test("resolveCrudListParentDescriptor selects the nearest lookup route parent", () => {
  const descriptor = resolveCrudListParentDescriptor({
    resource: contactChildResource,
    route: {
      matched: [
        { path: "/w/:workspaceSlug/admin" },
        { path: "/w/:workspaceSlug/admin/contacts/:contactId/availabilities" }
      ],
      params: {
        workspaceSlug: "dogandgroom",
        contactId: "538779"
      }
    },
    recordIdParam: "availabilityRuleId"
  });

  assert.deepEqual(
    descriptor,
    {
      fieldKey: "contactId",
      routeParamKey: "contactId",
      relationNamespace: "contacts",
      entityLabel: "Contact",
      labelKey: "",
      fieldDescriptor: {
        key: "contactId",
        relation: {
          kind: "lookup",
          valueKey: "id",
          labelKey: "",
          containerKey: "lookups"
        }
      },
      apiUrlTemplate: "/contacts/:contactId"
    }
  );
});

test("resolveCrudListParentTitleFromItems uses the hydrated lookup label", () => {
  const descriptor = resolveCrudListParentDescriptor({
    resource: contactChildResource,
    route: {
      matched: [{ path: "/w/:workspaceSlug/admin/contacts/:contactId/availabilities" }],
      params: {
        workspaceSlug: "dogandgroom",
        contactId: "538779"
      }
    },
    recordIdParam: "availabilityRuleId"
  });

  const title = resolveCrudListParentTitleFromItems(
    [
      {
        id: 1,
        contactId: 538779,
        lookups: {
          contactId: {
            id: 538779,
            firstName: "Jessica",
            lastName: "Dickinson"
          }
        }
      }
    ],
    descriptor
  );

  assert.equal(title, "Jessica Dickinson");
});

test("resolveCrudListParentRecordTitle falls back to entity label plus id", () => {
  const title = resolveCrudListParentRecordTitle(
    {
      id: 538779
    },
    {
      entityLabel: "Contact",
      labelKey: ""
    }
  );

  assert.equal(title, "Contact #538779");
});

test("resolveCrudListParentDescriptor supports parentRouteParamKey aliases", () => {
  const descriptor = resolveCrudListParentDescriptor({
    resource: {
      operations: {
        view: {
          output: {
            schema: {
              type: "object",
              properties: {
                staffContactId: {
                  type: "integer",
                  parentRouteParamKey: "contactId",
                  relation: {
                    kind: "lookup",
                    namespace: "contacts",
                    valueKey: "id"
                  }
                }
              }
            }
          }
        }
      }
    },
    route: {
      matched: [{ path: "/w/:workspaceSlug/admin/contacts/:contactId/availabilities" }],
      params: {
        workspaceSlug: "dogandgroom",
        contactId: "538779"
      }
    },
    recordIdParam: "availabilityRuleId"
  });

  assert.equal(descriptor?.fieldKey, "staffContactId");
  assert.equal(descriptor?.routeParamKey, "contactId");
});
