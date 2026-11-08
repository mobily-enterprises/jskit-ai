import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { emptyInputValidator, resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createPackageTestKnex, startTestFeatures } from "../src/test/index.js";

// A route that reads its own tables without an action takes request.callOptions(): the call options the same request's
// action gets, from the same context contributors, so each table is scoped as the action would scope it.

const VISIBILITIES = Object.freeze(["user", "workspace", "workspace_user"]);
const userField = { type: "id", nullable: true, storage: { column: "user_id" } };
const workspaceField = { type: "id", nullable: true, storage: { column: "workspace_id" } };
const tables = Object.freeze([
  defineTableResource({ name: "bookmarks", tableName: "bookmarks", ownership: "user", schema: { userId: userField, title: { type: "string" } } }),
  defineTableResource({ name: "notes", tableName: "notes", ownership: "workspace", schema: { workspaceId: workspaceField, title: { type: "string" } } }),
  defineTableResource({
    name: "pins",
    tableName: "pins",
    ownership: "workspace_user",
    schema: { workspaceId: workspaceField, userId: userField, title: { type: "string" } }
  })
]);

// What auth-core and workspaces-core give every action of a request: the user and workspace the auth plugin resolved,
// and the route's visibility scope.
const RequestAuthProvider = defineProvider({
  id: "test.request-auth",
  requires: { actions: "runtime.actions", http: "runtime.http" },
  setup({ actions, http }) {
    actions.registerContextContributor({
      id: "test.request-auth",
      contribute: ({ context }) => {
        const request = context.requestMeta?.request;
        return { ...(request?.user ? { actor: request.user } : {}), ...(request?.workspace ? { workspace: request.workspace } : {}) };
      }
    });
    http.registerVisibilityResolver({
      id: "test.visibility",
      resolve: ({ visibility, context }) => {
        const userId = resolveActorId(context);
        const scopeOwnerId = context.workspace?.id;
        if (visibility === "user") return userId ? { userId, requiresActorScope: true } : {};
        if (visibility === "workspace") return scopeOwnerId ? { scopeKind: "workspace", scopeOwnerId } : {};
        if (visibility === "workspace_user") {
          return { scopeKind: "workspace_user", requiresActorScope: true, ...(scopeOwnerId ? { scopeOwnerId } : {}), ...(userId ? { userId } : {}) };
        }
        return {};
      }
    });
    return {};
  }
});

// Each table's titles the call options reach, or the owner they name none of.
async function readEveryTable(resources, options) {
  const reads = {};
  for (const { name } of tables) {
    try {
      reads[name] = (await resources[name].queryAll({}, options)).map(({ title }) => title).sort();
    } catch (error) {
      if (error?.code !== "RESOURCE_MISSING_SCOPE") throw error;
      reads[name] = "refused";
    }
  }
  return reads;
}

const ReadsFeature = defineFeature({
  id: "reads",
  domain: "reads",
  owns: tables,
  requires: { http: "runtime.http" },
  provides: { reads: "test.reads" },
  setup({ http, resources }) {
    const reads = (options) => readEveryTable(resources, options);
    for (const visibility of VISIBILITIES) {
      http.router.get(`/action/${visibility}`, { surface: "app", visibility }, async (request, reply) => {
        reply.send(await request.executeAction({ actionId: `reads.${visibility}` }));
      });
      http.router.get(`/hand/${visibility}`, { surface: "app", visibility }, async (request, reply) => {
        const options = await request.callOptions();
        reply.send({ reads: await reads(options), visibilityContext: options.context.visibilityContext });
      });
    }
    return { reads };
  },
  actions: ({ reads }) => VISIBILITIES.map((visibility) => ({
    id: `reads.${visibility}`,
    kind: "query",
    channels: ["api"],
    surfaces: ["app"],
    permission: { require: "none" },
    input: emptyInputValidator,
    execute: async (_input, context) => ({ reads: await reads({ context }), visibilityContext: context.visibilityContext })
  }))
});

function fastifyStub() {
  return {
    routes: [],
    log: { error() {} },
    route(value) { this.routes.push(value); },
    addHook() {},
    setErrorHandler() {},
    hasContentTypeParser: () => true,
    getDefaultJsonParser: () => (_request, body, done) => done(null, body),
    addContentTypeParser() {}
  };
}

test("a hand route's callOptions() scope user, workspace and workspace_user tables as the same request's action", async (t) => {
  // SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
  const knex = await createPackageTestKnex(t, { environment: process.env });
  for (const [table, columns] of [["bookmarks", ["user_id"]], ["notes", ["workspace_id"]], ["pins", ["workspace_id", "user_id"]]]) {
    await knex.schema.createTable(table, (builder) => {
      builder.increments("id");
      for (const column of columns) builder.integer(column);
      builder.string("title");
    });
  }
  await knex("bookmarks").insert([{ user_id: 7, title: "7's" }, { user_id: 8, title: "8's" }]);
  await knex("notes").insert([{ workspace_id: 1, title: "in 1" }, { workspace_id: 2, title: "in 2" }]);
  await knex("pins").insert([{ workspace_id: 1, user_id: 7, title: "7's in 1" }, { workspace_id: 1, user_id: 8, title: "8's in 1" }, { workspace_id: 2, user_id: 7, title: "7's in 2" }]);
  const fastify = fastifyStub();
  const { stop } = await startTestFeatures({ knex, features: [HttpProvider, RequestAuthProvider, ReadsFeature], inputs: { "runtime.fastify": fastify } });
  t.after(stop);

  async function call(path, requestValues) {
    const route = fastify.routes.find(({ url }) => url === path);
    const reply = { statusCode: 200, headers: {}, code() { return this; }, header() { return this; }, hasHeader: () => false, send(value) { this.payload = value; return this; } };
    await route.handler({ params: {}, routeOptions: { config: route.config }, ...requestValues }, reply);
    return reply.payload;
  }

  const member = { user: { id: "7" }, workspace: { id: "1" } };
  const expected = {
    user: [{ user: member.user }, { bookmarks: ["7's"], notes: "refused", pins: "refused" }],
    workspace: [member, { bookmarks: "refused", notes: ["in 1"], pins: "refused" }],
    workspace_user: [member, { bookmarks: ["7's"], notes: ["in 1"], pins: ["7's in 1"] }]
  };
  for (const visibility of VISIBILITIES) {
    const [request, reads] = expected[visibility];
    const action = await call(`/action/${visibility}`, request);
    assert.deepEqual(await call(`/hand/${visibility}`, request), action, `${visibility} route`);
    assert.deepEqual(action.reads, reads, `${visibility} route`);
    // A request with no one signed in gets no user scope, exactly as its action does.
    const anonymous = await call(`/hand/${visibility}`, {});
    assert.deepEqual(anonymous, await call(`/action/${visibility}`, {}), `${visibility} route, signed out`);
    assert.equal(anonymous.reads.bookmarks, "refused");
    assert.equal(anonymous.visibilityContext.userId ?? null, null);
  }
});
