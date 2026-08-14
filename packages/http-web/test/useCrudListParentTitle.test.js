import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { resolveCrudListParentDescriptor, resolveCrudListParentRecordTitle, resolveCrudListParentTitleFromItems } from "../src/client/composables/internal/crudListParentTitleSupport.js";
import { useCrudListParentTitle } from "../src/client/composables/useCrudListParentTitle.js";

const contactChildResource = Object.freeze({
  contract: {
    lookup: {
      containerKey: "lookups"
    }
  },
  operations: {
    view: {
      output: {
        schema: createSchema({
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
        })
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

test("resolveCrudListParentTitleFromItems ignores raw lookup ids when no hydrated label is present", () => {
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
        contactId: 538779
      }
    ],
    descriptor
  );

  assert.equal(title, "");
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
            schema: createSchema({
              staffContactId: {
                type: "integer",
                parentRouteParamKey: "contactId",
                relation: {
                  kind: "lookup",
                  namespace: "contacts",
                  valueKey: "id"
                }
              }
            })
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

test("useCrudListParentTitle loads the parent record when child rows only expose the raw parent id", () => {
  const runtime = useCrudListParentTitle({
    listRuntime: {
      items: [
        {
          id: 1,
          contactId: 538779
        }
      ],
      isInitialLoading: false,
      loadError: ""
    },
    resource: contactChildResource,
    recordIdParam: "availabilityRuleId",
    route: {
      matched: [{ path: "/w/:workspaceSlug/admin/contacts/:contactId/availabilities" }],
      params: {
        workspaceSlug: "dogandgroom",
        contactId: "538779"
      }
    },
    viewRuntimeFactory: () => ({
      record: {
        id: 538779,
        firstName: "Jessica",
        lastName: "Dickinson"
      },
      isLoading: false,
      loadError: ""
    })
  });

  assert.equal(runtime.shouldLoadParentRecord, true);
  assert.equal(runtime.title, "Jessica Dickinson");
});

test("useCrudListParentTitle requests the parent through JSON:API record transport", () => {
  let capturedTransport = null;

  useCrudListParentTitle({
    listRuntime: {
      items: [
        {
          id: 1,
          contactId: 538779
        }
      ],
      isInitialLoading: false,
      loadError: ""
    },
    resource: contactChildResource,
    recordIdParam: "availabilityRuleId",
    route: {
      matched: [{ path: "/w/:workspaceSlug/admin/contacts/:contactId/availabilities" }],
      params: {
        workspaceSlug: "dogandgroom",
        contactId: "538779"
      }
    },
    viewRuntimeFactory: (options = {}) => {
      capturedTransport = options.transport;
      return {
        record: {
          id: 538779,
          fullName: "Jessica Dickinson"
        },
        isLoading: false,
        loadError: ""
      };
    }
  });

  assert.deepEqual(capturedTransport, {
    kind: "jsonapi-resource",
    responseType: "contacts",
    responseKind: "record"
  });
});
