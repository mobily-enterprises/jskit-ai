import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRouteParamNames,
  resolveScopedRoutePathname,
  resolveRouteParamNamesInOrder
} from "../src/client/composables/support/routeTemplateHelpers.js";

test("extractRouteParamNames reads dynamic params from route templates", () => {
  assert.deepEqual(
    extractRouteParamNames("/w/:workspaceSlug/admin/contacts/:contactId/addresses/:addressId"),
    ["workspaceSlug", "contactId", "addressId"]
  );
});

test("resolveRouteParamNamesInOrder prefers matched route templates", () => {
  const route = {
    matched: [
      { path: "/w/:workspaceSlug/admin" },
      { path: "/contacts/:contactId/addresses/:addressId" }
    ],
    params: {
      workspaceSlug: "acme",
      contactId: "7",
      addressId: "42"
    }
  };

  assert.deepEqual(resolveRouteParamNamesInOrder(route), ["workspaceSlug", "contactId", "addressId"]);
});

test("resolveScopedRoutePathname supports at/before/after anchors", () => {
  const currentPathname = "/w/dogandgroom/admin/contacts/541841/pets/715528/edit/advanced";
  const params = {
    workspaceSlug: "dogandgroom",
    contactId: "541841",
    petId: "715528"
  };
  const orderedParamNames = ["workspaceSlug", "contactId", "petId"];

  assert.equal(
    resolveScopedRoutePathname({
      currentPathname,
      params,
      orderedParamNames,
      anchorParamName: "contactId",
      anchorMode: "at"
    }),
    "/w/dogandgroom/admin/contacts/541841"
  );
  assert.equal(
    resolveScopedRoutePathname({
      currentPathname,
      params,
      orderedParamNames,
      anchorParamName: "petId",
      anchorMode: "before"
    }),
    "/w/dogandgroom/admin/contacts/541841/pets"
  );
  assert.equal(
    resolveScopedRoutePathname({
      currentPathname,
      params,
      orderedParamNames,
      anchorParamName: "petId",
      anchorMode: "after"
    }),
    "/w/dogandgroom/admin/contacts/541841/pets/715528/edit"
  );
});

test("resolveScopedRoutePathname falls back to direct value matching", () => {
  assert.equal(
    resolveScopedRoutePathname({
      currentPathname: "/contacts/abc%20123/notes",
      params: {},
      orderedParamNames: [],
      anchorParamName: "contactId",
      anchorParamValue: "abc 123",
      anchorMode: "at"
    }),
    "/contacts/abc%20123"
  );
});
