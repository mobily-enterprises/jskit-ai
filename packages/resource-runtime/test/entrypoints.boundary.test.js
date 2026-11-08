import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import knexLib from "knex";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { JsonRestApi, RestApiFieldsetError, RestApiWriteError } from "json-rest-api";

import {
  buildJsonRestQueryParams,
  createJsonRestContext,
  createResourceHost,
  resourceScopeOptions,
  returnNullWhenJsonRestResourceMissing,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  resolveWorkspaceScopeValue,
  resolveUserScopeValue
} from "../src/server/resourceHost.js";
import { ResourceRuntimeProvider } from "../src/server/ResourceRuntimeProvider.js";

test("package exports its provider and helpers, its types and its test helpers, never the host or the runtime", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], "./src/server/index.js");
  assert.equal(Object.hasOwn(exportsMap, "./server/resourceHost"), false);
  assert.equal(exportsMap["./server/types"], "./src/server/types.js");
  assert.equal(exportsMap["./test"], "./src/test/index.js");
  // Tables are owned through a feature (or createStandaloneResources outside a server), and system contexts come only
  // from a declared system scope, so the host and the runtime themselves stay inside the package.
  const server = await import("../src/server/index.js");
  for (const name of ["createResourceRuntime", "createResourceHost", "createSystemContext", "createJsonRestContext"]) {
    assert.equal(Object.hasOwn(server, name), false, name);
  }
  assert.equal(typeof server.createStandaloneResources, "function");
  assert.equal(typeof server.buildJsonRestQueryParams, "function");
  assert.equal(typeof server.passedOn, "function");
  // passedOn is resource-core's, which code that runs without the table runtime imports itself.
  assert.equal(server.passedOn, (await import("@jskit-ai/resource-core/shared/callOptions")).passedOn);
  assert.equal(typeof server.resolveWorkspaceScopeValue, "function");
  assert.equal(typeof server.withoutHiddenFields, "function");
});

test("standalone resources on a server's Knex client never own a table one of the server's features owns", async (t) => {
  const { createStandaloneResources } = await import("../src/server/index.js");
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  const other = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => Promise.all([knex.destroy(), other.destroy()]));
  const table = (name) => defineTableResource({ name, tableName: name, ownership: "public", schema: { title: { type: "string" } } });
  const { resources: runtime } = await ResourceRuntimeProvider.setup({ database: { knex }, logger: silentLogger });
  await runtime.own("notes.feature", [table("notes")]);
  await assert.rejects(
    createStandaloneResources({ knex, feature: "notes.script", owns: [table("notes")], systemScope: "every note" }),
    /Standalone resources "notes\.script" own table "notes", which feature "notes\.feature" of this server already owns/u
  );
  // A table no feature owns, or the same table on a Knex client no server uses, is the script's own.
  assert.ok((await createStandaloneResources({ knex, feature: "memos.script", owns: [table("memos")] })).resources.memos);
  assert.ok((await createStandaloneResources({ knex: other, feature: "notes.script", owns: [table("notes")] })).resources.notes);
});

test("server resourceHost entrypoint exposes only the focused host API", async () => {
  const hostModule = await import("../src/server/resourceHost.js");
  assert.equal(Object.hasOwn(hostModule, "simplifyJsonApiDocument"), false);
  assert.equal(Object.hasOwn(hostModule, "createJsonApiInputRecord"), false);
  assert.equal(Object.hasOwn(hostModule, "createJsonApiRelationship"), false);
  assert.equal(Object.hasOwn(hostModule, "addResourceIfMissing"), false);
  assert.equal(Object.hasOwn(hostModule, "queryAllJsonRestCollectionRows"), false);
});

test("server entrypoint exports shared host helpers", () => {
  assert.equal(typeof buildJsonRestQueryParams, "function");
  assert.equal(typeof resourceScopeOptions, "function");
  assert.equal(typeof createJsonRestContext, "function");
  assert.equal(typeof createResourceHost, "function");
  assert.equal(typeof returnNullWhenJsonRestResourceMissing, "function");
  assert.equal(typeof returnBadRequestWhenJsonRestFieldsetInvalid, "function");
  assert.equal(typeof resolveWorkspaceScopeValue, "function");
  assert.equal(typeof resolveUserScopeValue, "function");
  assert.equal(ResourceRuntimeProvider.id, "runtime.resources");
  assert.deepEqual(ResourceRuntimeProvider.requires, { database: "runtime.database", logger: "runtime.logger" });
  assert.deepEqual(ResourceRuntimeProvider.provides, { resources: "runtime.resources" });
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

test("createResourceHost installs normalizeRecordId as the default resource id normalizer", async () => {
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

  const api = await createResourceHost({
    knex: fakeKnex,
    logger: silentLogger
  });

  assert.equal(api.vars.normalizeId, normalizeRecordId);
  assert.equal(api.vars.normalizeId(7), "7");
  assert.equal(api.vars.normalizeId(0), null);
  assert.equal(api.vars.normalizeId(7.5), null);
});

test("createResourceHost uses the v2 runtime and the logger it is given", async () => {
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

  const messages = [];
  const api = await createResourceHost({
    knex: fakeKnex,
    logger: { ...silentLogger, error: (...args) => messages.push(args) }
  });

  assert.ok(api instanceof JsonRestApi);
  await assert.rejects(
    () => createResourceHost({ knex: fakeKnex }),
    /createResourceHost requires a logger with debug, info, warn and error\./
  );
  await assert.rejects(
    () => createResourceHost({ knex: fakeKnex, logger: { error() {} } }),
    /createResourceHost requires a logger/
  );
  assert.equal(api.vars.format, "plain");
  assert.equal(api.vars.returning, "full");
  assert.equal(api.options.logging, undefined);
  api.log.error("failure", { code: "example" });
  assert.deepEqual(messages, [["failure", { code: "example" }]]);

  const provided = await ResourceRuntimeProvider.setup({ database: { knex: fakeKnex }, logger: silentLogger });
  assert.deepEqual(Object.keys(provided), ["resources"]);
});

test("createResourceHost installs row policies before resources are added", async () => {
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

  const api = await createResourceHost({ knex: fakeKnex, logger: silentLogger });
  const rowPolicy = () => false;
  const scopeOptions = resourceScopeOptions(defineTableResource({
    name: "privateContacts",
    tableName: "private_contacts",
    ownership: "public",
    schema: {
      id: { type: "id", primary: true }
    }
  }), {
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

test("shared query helper builds json-rest-api request shapes", () => {
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

test("resourceScopeOptions clones canonical resource metadata and resolves symbolic write serializers", () => {
  const serializer = (value) => value;
  const normalizeId = (value) => String(value || "").trim() || null;
  const rowPolicy = () => false;
  const source = defineTableResource({
    name: "contacts",
    tableName: "contacts",
    ownership: "workspace",
    defaultSort: Object.freeze(["-createdAt"]),
    schema: Object.freeze({
      name: Object.freeze({
        type: "string",
        maxLength: 190,
        required: true,
        search: true
      }),
      createdAt: Object.freeze({
        type: "dateTime",
        storage: Object.freeze({
          column: "created_at",
          writeSerializer: "datetime-utc"
        })
      }),
      publishedOn: Object.freeze({
        type: "date"
      }),
      bookingSteps: Object.freeze({
        type: "array",
        storage: Object.freeze({
          virtual: true
        })
      }),
      pets: Object.freeze({
        type: "array",
        relation: Object.freeze({
          kind: "collection",
          namespace: "pets",
          foreignKey: "contactId"
        })
      })
    }),
    relationships: Object.freeze({
      auditEvents: Object.freeze({
        type: "hasMany",
        target: "auditEvents",
        foreignKey: "contactId"
      })
    })
  });

  const result = resourceScopeOptions(source, {
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
  assert.equal(result.schema.publishedOn.storage, undefined);
  assert.equal(result.schema.bookingSteps.virtual, true);
  assert.equal(result.schema.pets.virtual, true);
  assert.equal(result.normalizeId, normalizeId);
  assert.equal(result.rowPolicy, rowPolicy);
  assert.equal(result.schema.name.maxLength, 190);
  assert.equal(result.autofilter, "workspace");
  assert.equal(Object.hasOwn(result, "ownership"), false);
  assert.equal(Object.hasOwn(result, "name"), false);
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

test("resourceScopeOptions maps server query projections into json-rest-api queryFields", () => {
  const select = ({ raw }) => raw("1");
  const resource = defineTableResource({
    name: "receivals",
    tableName: "receivals",
    ownership: "public",
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
  });

  const result = resourceScopeOptions(resource, {
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
  // Each select is called with a value-only raw, column() and the read's filters, never json-rest-api's Knex.
  const db = { raw: (sql, bindings) => ({ sql, bindings, toSQL: () => ({ sql, bindings }) }) };
  for (const field of ["remainingProcessableWeight", "availableCapacityWeight"]) {
    assert.equal(result.queryFields[field].select({ db, column: (name) => name, context: {} }).sql, "1");
  }
  // Every resource's filters also take `id`, one id or a list of them.
  assert.deepEqual(result.searchSchema, {
    status: { type: "string", filterOperator: "=" },
    id: { type: "array", actualField: "id", filterOperator: "in" }
  });
  assert.equal(resource.schema.remainingProcessableWeight.storage.virtual, true);
});

test("resourceScopeOptions refuses a resource's own id filter, since every handle filters by one id or a list", () => {
  const declared = defineTableResource({
    name: "tickets",
    tableName: "tickets",
    ownership: "public",
    searchSchema: { id: { type: "id", actualField: "id" } },
    schema: { title: { type: "string", required: true } }
  });
  const searchedId = defineTableResource({
    name: "ticketSettings",
    tableName: "ticket_settings",
    ownership: "public",
    idProperty: "ticket_id",
    schema: { id: { type: "id", primary: true, required: true, search: true, storage: { column: "ticket_id" } } }
  });
  const plain = defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "public",
    schema: { title: { type: "string", required: true } }
  });
  assert.throws(() => resourceScopeOptions(declared), /"tickets" declares its own id filter: every handle filters by id/u);
  assert.throws(() => resourceScopeOptions(searchedId), /"ticketSettings" declares its own id filter/u);
  assert.throws(
    () => resourceScopeOptions(plain, { searchSchema: { id: { type: "id", actualField: "id" } } }),
    /"notes" declares its own id filter/u
  );
});

test("resourceScopeOptions applies resource-owned default response exclusions", () => {
  const source = defineTableResource({
    name: "contacts",
    tableName: "contacts",
    ownership: "public",
    defaultExclude: [
      "privateNotes",
      "searchRank"
    ],
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

  const result = resourceScopeOptions(source);

  assert.equal(Object.hasOwn(result, "defaultExclude"), false);
  assert.equal(Object.hasOwn(result, "autofilter"), false);
  assert.equal(result.schema.name.normallyHidden, undefined);
  assert.equal(result.schema.privateNotes.normallyHidden, true);
  assert.equal(result.queryFields.searchRank.normallyHidden, true);
  assert.equal(source.schema.privateNotes.normallyHidden, undefined);
  assert.equal(source.schema.searchRank.normallyHidden, undefined);
});

test("resourceScopeOptions rejects invalid default response exclusions", () => {
  const createResource = (defaultExclude) => defineTableResource({
    name: "contacts",
    tableName: "contacts",
    ownership: "public",
    defaultExclude,
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
    () => resourceScopeOptions(createResource("name")),
    /resource defaultExclude must be an array/
  );
  assert.throws(
    () => resourceScopeOptions(createResource(["unknown"])),
    /defaultExclude references unknown field "unknown"/
  );
  assert.throws(
    () => resourceScopeOptions(createResource(["id"])),
    /defaultExclude cannot exclude identifier field "id"/
  );
});

test("resourceScopeOptions rejects query field names for column-backed schema fields", () => {
  assert.throws(
    () => resourceScopeOptions(defineTableResource({
      name: "receivals",
      tableName: "receivals",
      ownership: "public",
      schema: {
        id: { type: "id", primary: true },
        status: { type: "string" }
      }
    }), {
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

test("createResourceHost installs json-rest-api query projections", async (t) => {
  const knex = knexLib({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true
  });
  t.after(() => knex.destroy());
  await knex.schema.createTable("projection_contacts", (table) => {
    table.increments("id");
  });
  await knex("projection_contacts").insert({ id: 1 });
  const api = await createResourceHost({ knex, logger: silentLogger });

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

  const result = await api.resources.projectionContacts.query({ format: "plain" });
  assert.deepEqual(result.data, [{ id: "1", displayName: "Display" }]);
});

async function createTemporalFixture() {
  const knex = knexLib({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true
  });
  try {
    await knex.schema.createTable("holidays", (table) => {
      table.increments("id");
      table.date("observed_on");
    });
    await knex.schema.createTable("books", (table) => {
      table.increments("id");
      table.date("published_on");
      table.dateTime("scheduled_at");
      table.time("opens_at");
      table.integer("holiday_id").references("id").inTable("holidays");
    });
    const api = await createResourceHost({ knex, logger: silentLogger });
    await api.addResource("holidays", resourceScopeOptions(defineTableResource({
      name: "holidays",
      tableName: "holidays",
      ownership: "public",
      schema: {
        id: { type: "id", primary: true },
        observedOn: { type: "date" }
      }
    })));
    await api.addResource("books", resourceScopeOptions(defineTableResource({
      name: "books",
      tableName: "books",
      ownership: "public",
      schema: {
        id: { type: "id", primary: true },
        publishedOn: { type: "date" },
        scheduledAt: { type: "dateTime" },
        opensAt: { type: "time" },
        holidayId: { type: "id", belongsTo: "holidays", as: "holiday", nullable: true }
      }
    })));
    return { api, knex };
  } catch (error) {
    await knex.destroy();
    throw error;
  }
}

test("createResourceHost uses core temporal normalization for writes, reads and includes", async (t) => {
  const { api, knex } = await createTemporalFixture();
  t.after(() => knex.destroy());
  const holiday = await api.resources.holidays.post({ data: { observedOn: "2024-03-01" } });
  const book = await api.resources.books.post({
    data: {
      publishedOn: "2024-02-29",
      scheduledAt: "2024-02-29T20:34:56+08:00",
      opensAt: "09:45",
      holiday: holiday.id
    }
  });

  assert.equal(book.publishedOn, "2024-02-29");
  assert.equal(book.scheduledAt, "2024-02-29T12:34:56.000Z");
  assert.equal(book.opensAt, "09:45:00");
  const document = await api.resources.books.get({
    id: book.id,
    format: "jsonapi",
    queryParams: { include: ["holiday"] }
  });
  assert.equal(document.data.attributes.publishedOn, "2024-02-29");
  assert.equal(document.data.attributes.scheduledAt, "2024-02-29T12:34:56.000Z");
  assert.equal(document.included[0].attributes.observedOn, "2024-03-01");
  await assert.rejects(
    () => api.resources.books.patch({ id: book.id, data: { publishedOn: "2023-02-29" } }),
    (error) => error.code === "REST_API_VALIDATION"
  );
});

test("calendar date writes and responses keep leap day across server time zones", () => {
  const hostModuleUrl = new URL("../src/server/resourceHost.js", import.meta.url).href;
  const script = `
    import knexLib from "knex";
    import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
    import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
    import { createResourceHost, resourceScopeOptions } from ${JSON.stringify(hostModuleUrl)};
    ${createTemporalFixture.toString()}
    const { api, knex } = await createTemporalFixture();
    try {
      const book = await api.resources.books.post({
        data: {
          publishedOn: "2024-02-29",
          scheduledAt: "2024-02-29T12:34:56.000Z",
          opensAt: "09:45:00"
        }
      });
      const row = await knex("books").where({ id: book.id }).first();
      process.stdout.write(JSON.stringify({
        write: row.published_on,
        publishedOn: book.publishedOn,
        scheduledAt: book.scheduledAt,
        opensAt: book.opensAt
      }));
    } finally {
      await knex.destroy();
    }
  `;

  for (const timezone of ["UTC", "Australia/Perth", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      env: { ...process.env, TZ: timezone }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      write: Date.parse("2024-02-29T00:00:00.000Z"),
      publishedOn: "2024-02-29",
      scheduledAt: "2024-02-29T12:34:56.000Z",
      opensAt: "09:45:00"
    }, timezone);
  }
});

test("createResourceHost maps native database datetime strings through core reads", async (t) => {
  const { api, knex } = await createTemporalFixture();
  t.after(() => knex.destroy());
  await knex("books").insert({
    id: 1,
    published_on: "2024-02-29",
    scheduled_at: "2024-02-29 12:34:56.123",
    opens_at: "09:45:00"
  });
  const book = await api.resources.books.get({ id: "1" });
  assert.equal(book.scheduledAt, "2024-02-29T12:34:56.123Z");
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
      assert.equal(error.cause, sparseFieldError);
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

test("missing-resource mapping preserves failures from unresolved or committed writes", async () => {
  const cause = Object.freeze({ code: "REST_API_RESOURCE", subtype: "not_found" });
  for (const transactionOutcome of ["pending", "committed", "unknown"]) {
    const failure = new RestApiWriteError("Missing resource", { cause, transactionOutcome });
    await assert.rejects(
      () => returnNullWhenJsonRestResourceMissing(() => Promise.reject(failure)),
      (error) => error === failure
    );
  }
  for (const transactionOutcome of ["none", "rolledBack"]) {
    const failure = new RestApiWriteError("Missing resource", { cause, transactionOutcome });
    assert.equal(await returnNullWhenJsonRestResourceMissing(() => Promise.reject(failure)), null);
  }
});

test("fieldset mapping retains write outcome and the original error chain", async () => {
  const cause = Object.freeze(new RestApiFieldsetError({ field: "privateNotes", resourceType: "books" }));
  const failure = new RestApiWriteError(cause.message, { cause, transactionOutcome: "committed" });
  await assert.rejects(
    () => returnBadRequestWhenJsonRestFieldsetInvalid(() => Promise.reject(failure)),
    (error) => {
      assert.equal(error.code, "JSON_API_FIELDSET_INVALID");
      assert.equal(error.transactionOutcome, "committed");
      assert.equal(error.cause, failure);
      assert.equal(error.cause.cause, cause);
      return true;
    }
  );
});

test("unrelated primitive failures remain unchanged through host error mapping", async () => {
  for (const failure of [null, undefined, "failure", 7]) {
    for (const mapError of [returnNullWhenJsonRestResourceMissing, returnBadRequestWhenJsonRestFieldsetInvalid]) {
      await assert.rejects(
        () => mapError(() => Promise.reject(failure)),
        (error) => error === failure
      );
    }
  }
});

test("scope resolvers understand explicit scopeValues and JSKIT visibilityContext", () => {
  assert.equal(resolveWorkspaceScopeValue({
    scopeValues: {
      workspaceId: "workspace-explicit"
    },
    visibilityContext: {
      scopeOwnerId: "workspace-explicit"
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
      userId: "user-explicit"
    }
  }), "user-explicit");
  assert.equal(resolveUserScopeValue({ scopeValues: { userId: "user-explicit" } }), "user-explicit");
  // Like two workspaces, two users in one context is refused instead of one of them winning.
  assert.throws(() => resolveUserScopeValue({
    scopeValues: { userId: "user-explicit" },
    visibilityContext: { userId: "user-visibility" }
  }), /safety invariant: a context names two users \(user-explicit, user-visibility\)/u);

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

test("json-rest-api's fixed-English errors render from the resource-runtime catalog", async () => {
  const { RestApiPreconditionFailedError, RestApiVersionConflictError } = await import("json-rest-api");
  const { catalogMessage, formatMessage, messageKeyForCode } = await import("@jskit-ai/kernel/shared/i18n");
  const english = JSON.parse(await readFile(new URL("../locales/en.json", import.meta.url), "utf8"));
  for (const error of [new RestApiVersionConflictError(), new RestApiPreconditionFailedError()]) {
    assert.equal(formatMessage(catalogMessage(english, messageKeyForCode(error.code)), {}), error.message, error.code);
  }
});
