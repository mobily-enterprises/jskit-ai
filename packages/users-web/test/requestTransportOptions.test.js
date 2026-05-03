import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEndpointReadRequestOptions,
  buildEndpointWriteRequestOptions
} from "../src/client/composables/runtime/useEndpointResource.js";
import { buildListRequestOptions } from "../src/client/composables/runtime/useListCore.js";

test("endpoint read request options include transport only when provided", () => {
  assert.deepEqual(
    buildEndpointReadRequestOptions({
      method: "get"
    }),
    {
      method: "GET"
    }
  );

  assert.deepEqual(
    buildEndpointReadRequestOptions({
      method: "get",
      transport: {
        kind: "jsonapi-resource",
        responseType: "user-settings",
        responseKind: "record"
      }
    }),
    {
      method: "GET",
      transport: {
        kind: "jsonapi-resource",
        responseType: "user-settings",
        responseKind: "record"
      }
    }
  );
});

test("endpoint write request options preserve body/options and append transport", () => {
  assert.deepEqual(
    buildEndpointWriteRequestOptions({
      method: "patch",
      body: {
        theme: "dark"
      },
      options: {
        headers: {
          "x-demo": "1"
        }
      },
      transport: {
        kind: "jsonapi-resource",
        requestType: "user-preferences",
        responseType: "user-settings",
        responseKind: "record"
      }
    }),
    {
      method: "PATCH",
      headers: {
        "x-demo": "1"
      },
      body: {
        theme: "dark"
      },
      transport: {
        kind: "jsonapi-resource",
        requestType: "user-preferences",
        responseType: "user-settings",
        responseKind: "record"
      }
    }
  );
});

test("list request options stay GET and carry transport when provided", () => {
  assert.deepEqual(
    buildListRequestOptions({
      requestOptions: {
        headers: {
          "x-demo": "1"
        }
      },
      pageParam: "cursor_2",
      transport: {
        kind: "jsonapi-resource",
        responseType: "contacts",
        responseKind: "collection"
      }
    }),
    {
      method: "GET",
      headers: {
        "x-demo": "1"
      },
      query: {
        limit: 20,
        cursor: "cursor_2"
      },
      transport: {
        kind: "jsonapi-resource",
        responseType: "contacts",
        responseKind: "collection"
      }
    }
  );
});

test("list request options preserve explicit limit values", () => {
  assert.deepEqual(
    buildListRequestOptions({
      requestOptions: {
        query: {
          limit: 50
        }
      }
    }),
    {
      method: "GET",
      query: {
        limit: 50
      }
    }
  );

  assert.deepEqual(
    buildListRequestOptions({
      requestOptions: {
        query: {
          "page[limit]": "75"
        }
      }
    }),
    {
      method: "GET",
      query: {
        "page[limit]": "75"
      }
    }
  );
});
