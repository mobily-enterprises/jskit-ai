import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import {
  createActionProvider,
  createEntityChangedActionEvent
} from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";

function emptyInput() {
  return { schema: createSchema({}) };
}

test("features capture only named capabilities and publish actions without container lookup", async () => {
  let setupActionCatalogue = null;
  const database = Object.freeze({
    async listBooks() {
      return [{ id: 1, title: "Kindred" }];
    }
  });
  const databaseProvider = defineProvider({
    id: "database.test",
    provides: { database: "runtime.database" },
    setup() {
      return { database };
    }
  });
  const booksFeature = defineFeature({
    id: "feature.books",
    domain: "books",
    requires: { database: "runtime.database" },
    provides: { books: "feature.books" },
    actionDefaults: {
      channels: ["api", "assistant"],
      surfaces: ["app"]
    },
    setup({ database: selectedDatabase }, { actionCatalogue }) {
      setupActionCatalogue = actionCatalogue;
      return {
        books: Object.freeze({
          list: () => selectedDatabase.listBooks()
        })
      };
    },
    actions({ books }) {
      return [{
        id: "books.list",
        kind: "query",
        input: emptyInput(),
        idempotency: "none",
        async execute() {
          return books.list();
        }
      }];
    }
  });

  let actions = null;
  const observer = defineProvider({
    id: "test.observer",
    requires: { actionCatalogue: "runtime.actions" },
    setup({ actionCatalogue }) {
      actions = actionCatalogue;
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [observer, booksFeature, createActionProvider(), databaseProvider]
  });
  await runtime.start();

  assert.deepEqual(actions.listDefinitions().map((entry) => entry.id), ["books.list"]);
  assert.deepEqual(
    await actions.execute({
      actionId: "books.list",
      context: { channel: "assistant", surface: "app" }
    }),
    [{ id: 1, title: "Kindred" }]
  );
  assert.equal(Object.hasOwn(actions, "make"), false);
  assert.equal(Object.hasOwn(actions, "resolve"), false);
  assert.equal(setupActionCatalogue, actions);
  assert.throws(
    () => actions.register({ contributorId: "late", domain: "late", actions: [] }),
    /registration is closed/u
  );
});

test("feature registration rejects duplicate actions and undeclared setup outputs", async () => {
  const action = {
    id: "books.read",
    kind: "query",
    channels: ["api"],
    surfaces: ["app"],
    input: emptyInput(),
    idempotency: "none",
    async execute() {
      return {};
    }
  };
  const first = defineFeature({ id: "feature.first", domain: "books", actions: [action] });
  const second = defineFeature({ id: "feature.second", domain: "books", actions: [action] });
  const duplicateRuntime = createCapabilityRuntime({
    providers: [createActionProvider(), first, second]
  });
  await assert.rejects(duplicateRuntime.start(), /duplicated between contributors/u);

  const undeclared = defineFeature({
    id: "feature.undeclared",
    setup() {
      return { surprise: true };
    }
  });
  const invalidRuntime = createCapabilityRuntime({
    providers: [createActionProvider(), undeclared]
  });
  await assert.rejects(invalidRuntime.start(), /outputs must be exactly: <none>/u);
});

test("action context contributors enrich execution without a request scope container", async () => {
  let actions;
  const actionProvider = createActionProvider();
  const feature = defineFeature({
    id: "feature.context-proof",
    domain: "context-proof",
    actions: [{
      id: "context-proof.read",
      kind: "query",
      channels: ["api"],
      surfaces: ["app"],
      input: emptyInput(),
      idempotency: "none",
      async execute(_input, context) {
        return context;
      }
    }]
  });
  const contributor = defineProvider({
    id: "test.context-contributor",
    requires: { actionCatalogue: "runtime.actions" },
    setup({ actionCatalogue }) {
      actions = actionCatalogue;
      actionCatalogue.registerContextContributor({
        id: "test.actor",
        contribute({ context }) {
          return {
            actorId: context.requestMeta?.request?.actorId || "anonymous",
            requestMeta: { contributed: true }
          };
        }
      });
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ providers: [actionProvider, contributor, feature] });

  await runtime.start();
  const context = await actions.execute({
    actionId: "context-proof.read",
    context: {
      channel: "api",
      surface: "app",
      requestMeta: {
        request: { actorId: "user-1" },
        callerOwned: true
      }
    }
  });

  assert.equal(context.actorId, "user-1");
  assert.equal(context.requestMeta.contributed, true);
  assert.deepEqual(context.requestMeta.request, { actorId: "user-1" });
  assert.equal(context.requestMeta.callerOwned, true);
  assert.throws(
    () => actions.registerContextContributor({ id: "late", contribute() {} }),
    /registration is closed/u
  );
  await runtime.shutdown();
});

test("feature actions publish explicit success events without service registrations", async () => {
  let actions;
  const received = [];
  const feature = defineFeature({
    id: "feature.event-proof",
    domain: "books",
    actions: [{
      id: "books.save",
      kind: "command",
      channels: ["api"],
      surfaces: ["app"],
      input: emptyInput(),
      idempotency: "none",
      events: [createEntityChangedActionEvent({
        source: "books",
        entity: "book",
        operation: "updated",
        entityId: ({ context }) => context.actor.id,
        realtime: {
          event: "books.changed",
          audience: "actor_user"
        }
      })],
      async execute() {
        return { saved: true };
      }
    }]
  });
  const listener = defineProvider({
    id: "test.event-listener",
    requires: {
      actionCatalogue: "runtime.actions",
      events: "runtime.events"
    },
    setup({ actionCatalogue, events }) {
      actions = actionCatalogue;
      events.register({ id: "test.capture", handle: (event) => received.push(event) });
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [EventProvider, createActionProvider(), feature, listener]
  });
  await runtime.start();

  await actions.execute({
    actionId: "books.save",
    input: {},
    context: { channel: "api", surface: "app", actor: { id: "7" } }
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].type, "entity.changed");
  assert.equal(received[0].entityId, "7");
  assert.equal(received[0].realtime.event, "books.changed");
  assert.equal(received[0].realtime.audience, "actor_user");
});
