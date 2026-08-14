import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { RestApiFieldsetError } from "json-rest-api";

import {
  INTERNAL_JSON_REST_API,
  addResourceIfMissing,
  buildJsonRestQueryParams,
  createJsonApiInputRecord,
  createJsonApiRelationship,
  createJsonRestResourceScopeOptions,
  createJsonRestContext,
  createJsonRestApiHost,
  extractJsonRestCollectionRows,
  isJsonRestResourceMissingError,
  registerJsonRestApiHost,
  returnNullWhenJsonRestResourceMissing,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  resolveWorkspaceScopeValue,
  resolveUserScopeValue
} from "../src/server/jsonRestApiHost.js";
import { JsonRestApiCoreServiceProvider } from "../src/server/JsonRestApiCoreServiceProvider.js";

test("package exports include explicit server jsonRestApiHost entrypoint only", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server/jsonRestApiHost"], "./src/server/jsonRestApiHost.js");
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(packageJson.dependencies?.["json-rest-api"], "^1.0.27");
});

test("server jsonRestApiHost entrypoint exposes only the focused host API", async () => {
  const hostModule = await import("../src/server/jsonRestApiHost.js");
  assert.equal(Object.hasOwn(hostModule, "simplifyJsonApiDocument"), false);
});

test("server entrypoint exports shared host helpers", () => {
  assert.equal(INTERNAL_JSON_REST_API, "internal.json-rest-api");
  assert.equal(typeof addResourceIfMissing, "function");
  assert.equal(typeof buildJsonRestQueryParams, "function");
  assert.equal(typeof createJsonApiInputRecord, "function");
  assert.equal(typeof createJsonApiRelationship, "function");
  assert.equal(typeof createJsonRestResourceScopeOptions, "function");
  assert.equal(typeof createJsonRestContext, "function");
  assert.equal(typeof createJsonRestApiHost, "function");
  assert.equal(typeof extractJsonRestCollectionRows, "function");
  assert.equal(typeof isJsonRestResourceMissingError, "function");
  assert.equal(typeof registerJsonRestApiHost, "function");
  assert.equal(typeof returnNullWhenJsonRestResourceMissing, "function");
  assert.equal(typeof returnBadRequestWhenJsonRestFieldsetInvalid, "function");
  assert.equal(typeof resolveWorkspaceScopeValue, "function");
  assert.equal(typeof resolveUserScopeValue, "function");
  assert.equal(typeof JsonRestApiCoreServiceProvider, "function");
});

test("createJsonRestContext returns a mutable clone for frozen JSKIT execution context", () => {
  const source = Object.freeze({
    visibilityContext: Object.freeze({
      visibility: "workspace",
      scopeOwnerId: "workspace-7",
      userId: "user-2"
    }),
    scopeValues: Object.freeze({
      workspaceId: "workspace-explicit"
    }),
    requestMeta: Object.freeze({
      traceId: "trace-1"
    })
  });

  const result = createJsonRestContext(source);

  assert.notEqual(result, source);
  assert.notEqual(result.visibilityContext, source.visibilityContext);
  assert.notEqual(result.scopeValues, source.scopeValues);
  assert.equal(result.requestMeta, source.requestMeta);

  result.method = "query";
  result.scopeValues.userId = "user-2";

  assert.equal(result.method, "query");
  assert.equal(result.scopeValues.userId, "user-2");
  assert.equal(source.scopeValues.userId, undefined);
});

test("createJsonRestContext returns an empty mutable object when source context is absent", () => {
  const result = createJsonRestContext(null);

  assert.deepEqual(result, {});
  result.method = "query";
  assert.equal(result.method, "query");
});

test("extractJsonRestCollectionRows understands the internal collection-document contract", () => {
  const rows = [{ id: "1" }, { id: "2" }];

  assert.deepEqual(extractJsonRestCollectionRows(rows), rows);
  assert.deepEqual(
    extractJsonRestCollectionRows({
      data: rows,
      links: {
        self: "/contacts"
      }
    }),
    rows
  );
  assert.deepEqual(extractJsonRestCollectionRows({ data: null }), []);
  assert.deepEqual(extractJsonRestCollectionRows(null), []);
});

test("createJsonRestApiHost installs normalizeRecordId as the default resource id normalizer", async () => {
  const fakeKnex = Object.assign(() => {}, {
    client: {
      config: {
        client: "sqlite3"
      }
    },
    async raw() {
      return [
        {
          version: "3.35.5"
        }
      ];
    },
    transaction() {}
  });

  const api = await createJsonRestApiHost({
    knex: fakeKnex
  });

  assert.equal(api.vars.normalizeId, normalizeRecordId);
  assert.equal(api.vars.normalizeId(7), "7");
  assert.equal(api.vars.normalizeId(0), null);
  assert.equal(api.vars.normalizeId(7.5), null);
});

test("createJsonRestApiHost configures the internal json-rest logger at error level", async () => {
  const fakeKnex = Object.assign(() => {}, {
    client: {
      config: {
        client: "sqlite3"
      }
    },
    async raw() {
      return [
        {
          version: "3.35.5"
        }
      ];
    },
    transaction() {}
  });

  const api = await createJsonRestApiHost({
    knex: fakeKnex
  });

  assert.equal(api.options.logging.level, "error");
});

test("createJsonRestApiHost installs row policies before resources are added", async () => {
  const fakeKnex = Object.assign(() => {}, {
    client: {
      config: {
        client: "sqlite3"
      }
    },
    async raw() {
      return [
        {
          version: "3.35.5"
        }
      ];
    },
    transaction() {}
  });

  const api = await createJsonRestApiHost({ knex: fakeKnex });
  const rowPolicy = () => false;
  const scopeOptions = createJsonRestResourceScopeOptions({
    tableName: "private_contacts",
    schema: {
      id: { type: "id", primary: true }
    }
  }, {
    rowPolicy
  });

  await api.addResource("privateContacts", scopeOptions);

  assert.deepEqual(api.rowPolicies.getConfig(), {
    policies: []
  });
  assert.deepEqual(api.rowPolicies.getScopeConfig("privateContacts"), {
    policy: "<inline>",
    source: "inline"
  });
  assert.equal(scopeOptions.rowPolicy, rowPolicy);
});

test("shared query/document helpers build json-rest-api request shapes", () => {
  assert.deepEqual(
    buildJsonRestQueryParams("contacts", {
      q: "Merc",
      cursor: "cursor_2",
      limit: 10,
      include: "workspace,user",
      sort: ["-createdAt", "name"],
      fields: {
        contacts: ["name", "dob"],
        workspaces: ["slug", "id"],
        "contact-notes": ["body", "id"]
      }
    }),
    {
      filters: {
        q: "Merc"
      },
      include: ["workspace", "user"],
      sort: ["-createdAt", "name"],
      page: {
        after: "cursor_2",
        size: "10"
      },
      fields: {
        contactNotes: "body,id",
        contacts: "dob,name",
        workspaces: "id,slug"
      }
    }
  );

  assert.deepEqual(
    createJsonApiInputRecord("contacts", {
      name: "Merc"
    }, {
      id: 7,
      relationships: {
        workspace: createJsonApiRelationship("workspaces", 9)
      }
    }),
    {
      data: {
        type: "contacts",
        id: "7",
        attributes: {
          name: "Merc"
        },
        relationships: {
          workspace: {
            data: {
              type: "workspaces",
              id: "9"
            }
          }
        }
      }
    }
  );

  assert.deepEqual(
    createJsonApiInputRecord("products", {
      serviceId: "9",
      name: "Style Groom"
    }, {
      resource: {
        schema: {
          serviceId: {
            type: "id",
            belongsTo: "services",
            as: "service"
          },
          name: {
            type: "string"
          }
        }
      }
    }),
    {
      data: {
        type: "products",
        attributes: {
          name: "Style Groom"
        },
        relationships: {
          service: {
            data: {
              type: "services",
              id: "9"
            }
          }
        }
      }
    }
  );

});

test("buildJsonRestQueryParams preserves structured filter values", () => {
  assert.deepEqual(
    buildJsonRestQueryParams("receivals", {
      status: ["pending", "open", ""],
      supplierId: [7, " 8 "],
      availability: true,
      weight: {
        min: 12.5,
        max: " 18 "
      },
      emptyList: [],
      emptyObject: {},
      emptyText: " ",
      cursor: "cursor_1"
    }),
    {
      filters: {
        status: ["pending", "open"],
        supplierId: [7, "8"],
        availability: true,
        weight: {
          min: 12.5,
          max: "18"
        }
      },
      page: {
        after: "cursor_1"
      }
    }
  );
});

test("createJsonRestResourceScopeOptions clones canonical resource metadata and resolves symbolic write serializers", () => {
  const serializer = (value) => value;
  const normalizeId = (value) => String(value || "").trim() || null;
  const rowPolicy = () => false;
  const source = Object.freeze({
    namespace: "contacts",
    tableName: "contacts",
    defaultSort: Object.freeze(["-createdAt"]),
    schema: Object.freeze({
      name: Object.freeze({
        type: "string",
        maxLength: 190,
        required: true,
        search: true,
        operations: Object.freeze({
          output: Object.freeze({
            required: true
          })
        })
      }),
      createdAt: Object.freeze({
        type: "dateTime",
        storage: Object.freeze({
          column: "created_at",
          writeSerializer: "datetime-utc"
        }),
        operations: Object.freeze({
          output: Object.freeze({
            required: true
          })
        })
      }),
      publishedOn: Object.freeze({
        type: "date",
        operations: Object.freeze({
          output: Object.freeze({
            required: true
          })
        })
      }),
      bookingSteps: Object.freeze({
        type: "array",
        storage: Object.freeze({
          virtual: true
        }),
        operations: Object.freeze({
          output: Object.freeze({
            required: false
          })
        })
      }),
      pets: Object.freeze({
        type: "array",
        relation: Object.freeze({
          kind: "collection",
          namespace: "pets",
          foreignKey: "contactId"
        }),
        operations: Object.freeze({
          output: Object.freeze({
            required: false
          })
        })
      })
    }),
    relationships: Object.freeze({
      auditEvents: Object.freeze({
        type: "hasMany",
        target: "auditEvents",
        foreignKey: "contactId"
      })
    }),
    operations: Object.freeze({
      view: Object.freeze({
        method: "GET"
      })
    })
  });

  const result = createJsonRestResourceScopeOptions(source, {
    normalizeId,
    rowPolicy,
    writeSerializers: {
      "datetime-utc": serializer
    }
  });

  assert.notEqual(result, source);
  assert.notEqual(result.schema, source.schema);
  assert.notEqual(result.schema.createdAt, source.schema.createdAt);
  assert.equal(result.schema.createdAt.storage.column, "created_at");
  assert.equal(result.schema.createdAt.storage.serialize, serializer);
  assert.equal(result.schema.createdAt.storage.serialize(null), null);
  assert.equal(result.schema.createdAt.storage.writeSerializer, undefined);
  assert.equal(
    result.schema.publishedOn.storage.serialize(new Date("2024-02-29T00:00:00.000Z")),
    "2024-02-29"
  );
  assert.equal(result.schema.publishedOn.storage.serialize("2024-02-29"), "2024-02-29");
  assert.equal(result.schema.publishedOn.storage.serialize(null), null);
  assert.throws(
    () => result.schema.publishedOn.storage.serialize("2023-02-29"),
    /valid YYYY-MM-DD/
  );
  assert.equal(result.schema.bookingSteps.virtual, true);
  assert.equal(result.schema.pets.virtual, true);
  assert.equal(result.normalizeId, normalizeId);
  assert.equal(result.rowPolicy, rowPolicy);
  assert.equal(result.schema.name.maxLength, 190);
  assert.equal(result.schema.name.operations.output.required, true);
  assert.equal(result.operations.view.method, "GET");
  assert.deepEqual(result.relationships, {
    pets: {
      type: "hasMany",
      target: "pets",
      foreignKey: "contactId"
    },
    auditEvents: {
      type: "hasMany",
      target: "auditEvents",
      foreignKey: "contactId"
    }
  });

  result.schema.createdAt.indexed = true;
  assert.equal(source.schema.createdAt.indexed, undefined);
});

test("createJsonRestResourceScopeOptions maps server query projections into json-rest-api queryFields", () => {
  const select = ({ knex }) => knex.raw("1");
  const resource = {
    namespace: "receivals",
    schema: {
      id: { type: "id", primary: true },
      remainingProcessableWeight: {
        type: "number",
        storage: {
          virtual: true,
          queryProjection: {
            sortable: true,
            select
          }
        }
      },
      availableCapacityWeight: {
        type: "number",
        storage: {
          virtual: true
        }
      }
    }
  };

  const result = createJsonRestResourceScopeOptions(resource, {
    queryFields: {
      availableCapacityWeight: {
        type: "number",
        select
      }
    },
    searchSchema: {
      status: { type: "string", filterOperator: "=" }
    }
  });

  assert.deepEqual(Object.keys(result.schema), ["id"]);
  assert.equal(result.queryFields.remainingProcessableWeight.type, "number");
  assert.equal(result.queryFields.remainingProcessableWeight.sortable, true);
  assert.equal(result.queryFields.remainingProcessableWeight.select, select);
  assert.equal(result.queryFields.availableCapacityWeight.select, select);
  assert.deepEqual(result.searchSchema, {
    status: { type: "string", filterOperator: "=" }
  });
  assert.equal(resource.schema.remainingProcessableWeight.storage.virtual, true);
});

test("createJsonRestResourceScopeOptions applies resource-owned default response exclusions", () => {
  const source = Object.freeze({
    namespace: "contacts",
    tableName: "contacts",
    contract: Object.freeze({
      response: Object.freeze({
        defaultExclude: Object.freeze([
          "privateNotes",
          "searchRank"
        ])
      })
    }),
    schema: Object.freeze({
      id: Object.freeze({
        type: "id",
        primary: true
      }),
      name: Object.freeze({
        type: "string"
      }),
      privateNotes: Object.freeze({
        type: "string"
      }),
      searchRank: Object.freeze({
        type: "number",
        storage: Object.freeze({
          virtual: true,
          queryProjection: Object.freeze({
            select() {}
          })
        })
      })
    })
  });

  const result = createJsonRestResourceScopeOptions(source);

  assert.equal(result.schema.name.normallyHidden, undefined);
  assert.equal(result.schema.privateNotes.normallyHidden, true);
  assert.equal(result.queryFields.searchRank.normallyHidden, true);
  assert.equal(source.schema.privateNotes.normallyHidden, undefined);
  assert.equal(source.schema.searchRank.normallyHidden, undefined);
});

test("createJsonRestResourceScopeOptions rejects invalid default response exclusions", () => {
  const createResource = (defaultExclude) => ({
    namespace: "contacts",
    tableName: "contacts",
    contract: {
      response: {
        defaultExclude
      }
    },
    schema: {
      id: {
        type: "id",
        primary: true
      },
      name: {
        type: "string"
      }
    }
  });

  assert.throws(
    () => createJsonRestResourceScopeOptions(createResource("name")),
    /contract\.response\.defaultExclude must be an array/
  );
  assert.throws(
    () => createJsonRestResourceScopeOptions(createResource(["unknown"])),
    /defaultExclude references unknown field "unknown"/
  );
  assert.throws(
    () => createJsonRestResourceScopeOptions(createResource(["id"])),
    /defaultExclude cannot exclude identifier field "id"/
  );
});

test("createJsonRestResourceScopeOptions rejects query field names for column-backed schema fields", () => {
  assert.throws(
    () => createJsonRestResourceScopeOptions({
      namespace: "receivals",
      schema: {
        id: { type: "id", primary: true },
        status: { type: "string" }
      }
    }, {
      queryFields: {
        status: {
          type: "string",
          select() {}
        }
      }
    }),
    /query field "status" conflicts with a column-backed schema field/
  );
});

test("createJsonRestApiHost installs json-rest-api query projections", async () => {
  const fakeKnex = Object.assign(() => {}, {
    client: {
      config: {
        client: "sqlite3"
      }
    },
    raw(sql) {
      if (String(sql || "").includes("sqlite_version")) {
        return [{ version: "3.35.5" }];
      }
      return { sql };
    },
    async transaction() {}
  });
  const api = await createJsonRestApiHost({ knex: fakeKnex });

  await api.addResource("projectionContacts", {
    tableName: "projection_contacts",
    schema: {
      id: { type: "id", primary: true }
    },
    queryFields: {
      displayName: {
        type: "string",
        select({ knex }) {
          return knex.raw("'Display'");
        }
      }
    }
  });

  assert.equal(typeof api.resources.projectionContacts.vars.queryFields.displayName.select, "function");
});

test("createJsonRestApiHost returns JSON-native temporal values from database records", async () => {
  const fakeKnex = Object.assign(() => {}, {
    client: {
      config: {
        client: "sqlite3"
      }
    },
    async raw() {
      return [{ version: "3.35.5" }];
    },
    transaction() {}
  });
  const api = await createJsonRestApiHost({ knex: fakeKnex });

  await api.addResource("books", createJsonRestResourceScopeOptions({
    tableName: "books",
    schema: {
      id: { type: "id", primary: true },
      publishedOn: { type: "date" },
      scheduledAt: { type: "dateTime" },
      opensAt: { type: "time" }
    }
  }));
  await api.addResource("holidays", createJsonRestResourceScopeOptions({
    tableName: "holidays",
    schema: {
      id: { type: "id", primary: true },
      observedOn: { type: "date" }
    }
  }));

  const scheduledAt = new Date("2024-02-29T12:34:56.000Z");
  const record = {
    data: {
      type: "books",
      id: "1",
      attributes: {
        publishedOn: new Date("2024-02-29T00:00:00.000Z"),
        scheduledAt,
        opensAt: "09:45:00"
      }
    },
    included: [{
      type: "holidays",
      id: "7",
      attributes: {
        observedOn: new Date("2024-03-01T00:00:00.000Z")
      }
    }]
  };

  await api.runHooks("finish", {
    record
  });

  assert.equal(record.data.attributes.publishedOn, "2024-02-29");
  assert.equal(record.data.attributes.scheduledAt, "2024-02-29T12:34:56.000Z");
  assert.equal(record.data.attributes.opensAt, "09:45:00");
  assert.equal(record.included[0].attributes.observedOn, "2024-03-01");
});

test("calendar date writes and responses keep leap day across server time zones", () => {
  const hostModuleUrl = new URL(
    "../src/server/jsonRestApiHost.js",
    import.meta.url
  ).href;
  const script = `
    import {
      createJsonRestApiHost,
      createJsonRestResourceScopeOptions
    } from ${JSON.stringify(hostModuleUrl)};
    const fakeKnex = Object.assign(() => {}, {
      client: { config: { client: "sqlite3" } },
      async raw() { return [{ version: "3.35.5" }]; },
      transaction() {}
    });
    const api = await createJsonRestApiHost({ knex: fakeKnex });
    const scopeOptions = createJsonRestResourceScopeOptions({
      tableName: "books",
      schema: {
        id: { type: "id", primary: true },
        publishedOn: { type: "date" },
        scheduledAt: { type: "dateTime" },
        opensAt: { type: "time" }
      }
    });
    await api.addResource("books", scopeOptions);
    const record = {
      data: {
        type: "books",
        id: "1",
        attributes: {
          publishedOn: new Date("2024-02-29T00:00:00.000Z"),
          scheduledAt: new Date("2024-02-29T12:34:56.000Z"),
          opensAt: "09:45:00"
        }
      }
    };
    await api.runHooks("finish", { record });
    process.stdout.write(JSON.stringify({
      write: scopeOptions.schema.publishedOn.storage.serialize(
        new Date("2024-02-29T00:00:00.000Z")
      ),
      publishedOn: record.data.attributes.publishedOn,
      scheduledAt: record.data.attributes.scheduledAt,
      opensAt: record.data.attributes.opensAt
    }));
  `;

  for (const timezone of ["UTC", "Australia/Perth", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        TZ: timezone
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      write: "2024-02-29",
      publishedOn: "2024-02-29",
      scheduledAt: "2024-02-29T12:34:56.000Z",
      opensAt: "09:45:00"
    }, timezone);
  }
});

test("createJsonRestApiHost maps UTC database datetimes to RFC 3339 strings", async () => {
  const fakeKnex = Object.assign(() => {}, {
    client: { config: { client: "sqlite3" } },
    async raw() {
      return [{ version: "3.35.5" }];
    },
    transaction() {}
  });
  const api = await createJsonRestApiHost({ knex: fakeKnex });

  await api.addResource("jobs", createJsonRestResourceScopeOptions({
    tableName: "jobs",
    schema: {
      id: { type: "id", primary: true },
      scheduledAt: { type: "dateTime" }
    }
  }));
  const record = {
    data: {
      type: "jobs",
      id: "1",
      attributes: {
        scheduledAt: "2024-02-29 12:34:56.123"
      }
    }
  };

  await api.runHooks("finish", { record });

  assert.equal(record.data.attributes.scheduledAt, "2024-02-29T12:34:56.123Z");
});

test("returnNullWhenJsonRestResourceMissing only swallows missing-resource errors", async () => {
  await assert.doesNotReject(async () => {
    const result = await returnNullWhenJsonRestResourceMissing(async () => {
      return "ok";
    });

    assert.equal(result, "ok");
  });

  const missing = Object.freeze({
    code: "REST_API_RESOURCE",
    subtype: "not_found"
  });

  assert.equal(isJsonRestResourceMissingError(missing), true);
  assert.equal(await returnNullWhenJsonRestResourceMissing(async () => {
    throw missing;
  }), null);

  const otherError = new Error("boom");
  await assert.rejects(
    async () => returnNullWhenJsonRestResourceMissing(async () => {
      throw otherError;
    }),
    (error) => error === otherError
  );
});

test("typed invalid sparse fields become a stable 400 without message matching", async () => {
  const sparseFieldError = new RestApiFieldsetError({
    field: "passwordHash",
    resourceType: "contacts"
  });

  await assert.rejects(
    () => returnBadRequestWhenJsonRestFieldsetInvalid(async () => {
      throw sparseFieldError;
    }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "JSON_API_FIELDSET_INVALID");
      assert.equal(error.message, sparseFieldError.message);
      return true;
    }
  );

  const messageOnlyError = new Error(sparseFieldError.message);
  await assert.rejects(
    () => returnBadRequestWhenJsonRestFieldsetInvalid(async () => {
      throw messageOnlyError;
    }),
    (error) => error === messageOnlyError
  );

  const unrelatedError = new Error("database unavailable");
  await assert.rejects(
    () => returnBadRequestWhenJsonRestFieldsetInvalid(async () => {
      throw unrelatedError;
    }),
    (error) => error === unrelatedError
  );
});

test("scope resolvers understand explicit scopeValues and JSKIT visibilityContext", () => {
  assert.equal(resolveWorkspaceScopeValue({
    scopeValues: {
      workspaceId: "workspace-explicit"
    },
    visibilityContext: {
      scopeOwnerId: "workspace-visibility"
    }
  }), "workspace-explicit");

  assert.equal(resolveWorkspaceScopeValue({
    visibilityContext: {
      scopeOwnerId: 42
    }
  }), "42");

  assert.equal(resolveUserScopeValue({
    scopeValues: {
      userId: "user-explicit"
    },
    visibilityContext: {
      userId: "user-visibility"
    }
  }), "user-explicit");

  assert.equal(resolveUserScopeValue({
    visibilityContext: {
      userId: 7
    }
  }), "7");

  assert.equal(resolveWorkspaceScopeValue({
    visibilityContext: {
      scopeOwnerId: "   "
    }
  }), null);
  assert.equal(resolveUserScopeValue(null), null);
});
