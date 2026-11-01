import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { ActionProvider } from "./actionProvider.js";
import { createActionCatalogue } from "./actionCatalogue.js";
import { EventProvider } from "../runtime/EventProvider.js";
import { silentLogger } from "../runtime/logger.js";
import { createCapabilityRuntime } from "../../shared/capabilities/runtime.js";
import { defineProvider } from "../../shared/capabilities/defineProvider.js";

const API_CONTEXT = Object.freeze({ channel: "api", surface: "app" });

function noteAction({ id = "notes.write", execute, events = [] } = {}) {
  return {
    id,
    kind: "command",
    channels: ["api"],
    surfaces: ["app"],
    input: { schema: createSchema({ text: { type: "string", required: true }, author: { type: "string" } }) },
    idempotency: "none",
    extensions: { notes: { scoped: true } },
    events,
    execute
  };
}

// A policy that registers each scoped action with a `scope` field instead of `author`, and runs it
// with the author it resolves, inside the scope its input names.
function createScopedPolicy(calls) {
  const scope = new AsyncLocalStorage();
  const policy = Object.freeze({
    input(definition) {
      calls.input.push(definition);
      if (!definition.extensions.notes) return definition.input;
      const fields = { ...definition.input.schema.getFieldDefinitions(), scope: { type: "string" } };
      delete fields.author;
      return { ...definition.input, schema: createSchema(fields) };
    },
    execute({ definition, input, context, run }) {
      calls.execute.push({ definition, input, context });
      if (!definition.extensions.notes) return run(input, context);
      const { scope: requested, ...noteInput } = input;
      if (requested === "closed") throw Object.assign(new Error("This scope is closed."), { code: "SCOPE_CLOSED" });
      return scope.run(requested, () => run({ ...noteInput, author: "resolved-author" }, { ...context, scoped: true }));
    }
  });
  return { policy, currentScope: () => scope.getStore() };
}

test("without a policy, actions are registered as declared and run their own execute", async () => {
  const received = [];
  const actions = createActionCatalogue();
  actions.register({
    contributorId: "notes",
    domain: "notes",
    actions: [noteAction({ execute: (input, context, deps) => received.push({ input, context, deps }) && "written" })]
  });

  const definition = actions.getDefinition("notes.write");
  assert.deepEqual(Object.keys(definition.input.schema.getFieldDefinitions()), ["text", "author"]);
  assert.deepEqual(definition.extensions, { notes: { scoped: true } });

  const result = await actions.execute({
    actionId: "notes.write",
    input: { text: "Hello", author: "Ada" },
    context: API_CONTEXT,
    deps: { clock: "test" }
  });
  assert.equal(result, "written");
  assert.deepEqual(received[0].input, { text: "Hello", author: "Ada" });
  assert.equal(received[0].context.channel, "api");
  assert.deepEqual(received[0].deps, { clock: "test" });
});

test("a policy's input is applied once per action, when it is registered, and the action is listed and validated with it", async () => {
  const calls = { input: [], execute: [] };
  const { policy } = createScopedPolicy(calls);
  const actions = createActionCatalogue({ policy });
  actions.register({ contributorId: "notes", domain: "notes", actions: [noteAction({ execute: (input) => input })] });
  actions.register({
    contributorId: "other",
    domain: "other",
    actions: [{ ...noteAction({ id: "other.write", execute: (input) => input }), extensions: {} }]
  });

  assert.deepEqual(calls.input.map((definition) => definition.id), ["notes.write", "other.write"]);
  assert.deepEqual(Object.keys(calls.input[0].input.schema.getFieldDefinitions()), ["text", "author"]);
  assert.deepEqual(Object.keys(actions.getDefinition("notes.write").input.schema.getFieldDefinitions()), ["text", "scope"]);
  assert.equal(actions.getDefinition("notes.write").input.mode, "patch");
  assert.deepEqual(Object.keys(actions.getDefinition("other.write").input.schema.getFieldDefinitions()), ["text", "author"]);
  assert.deepEqual(actions.listDefinitions().map((definition) => definition.id), ["notes.write", "other.write"]);

  await assert.rejects(
    actions.execute({ actionId: "notes.write", input: { text: "Hi", author: "Ada" }, context: API_CONTEXT }),
    (error) => error.code === "ACTION_VALIDATION_FAILED" && error.details.fieldErrors.author === "Field not allowed"
  );
  assert.equal(calls.execute.length, 0);
});

test("a policy runs each execution after the kernel's checks, with the declared action, and runs it inside its scope", async () => {
  const calls = { input: [], execute: [] };
  const { policy, currentScope } = createScopedPolicy(calls);
  const published = [];
  const received = [];
  const actions = createActionCatalogue({ policy, events: { publish: async (event) => published.push(event) } });
  actions.register({
    contributorId: "notes",
    domain: "notes",
    actions: [noteAction({
      execute: (input, context, deps) => received.push({ input, context, deps, scope: currentScope() }) && { ok: true },
      events: [({ input }) => ({ type: "note.written", input })]
    })]
  });

  const result = await actions.execute({
    actionId: "notes.write",
    input: { text: "Hello", scope: "home" },
    context: API_CONTEXT,
    deps: { clock: "test" }
  });

  assert.deepEqual(result, { ok: true });
  const [execution] = calls.execute;
  assert.deepEqual(Object.keys(execution.definition.input.schema.getFieldDefinitions()), ["text", "author"]);
  assert.deepEqual(execution.input, { text: "Hello", scope: "home" });
  assert.deepEqual(received, [{
    input: { text: "Hello", author: "resolved-author" },
    context: { ...received[0].context, scoped: true },
    deps: { clock: "test" },
    scope: "home"
  }]);
  assert.equal(received[0].context.channel, "api");
  assert.deepEqual(published, [{ type: "note.written", input: { text: "Hello", scope: "home" } }]);

  await assert.rejects(
    actions.execute({ actionId: "notes.write", input: { text: "Hi", scope: "home" }, context: { channel: "automation", surface: "app" } }),
    { code: "ACTION_CHANNEL_FORBIDDEN" }
  );
  assert.equal(calls.execute.length, 1);
});

test("a policy's error is the execution's error, and is logged as its failure", async () => {
  const calls = { input: [], execute: [] };
  const { policy } = createScopedPolicy(calls);
  const logged = [];
  const actions = createActionCatalogue({
    policy,
    logger: { ...silentLogger, debug: (entry) => logged.push(entry) }
  });
  actions.register({ contributorId: "notes", domain: "notes", actions: [noteAction({ execute: () => assert.fail("must not run") })] });

  await assert.rejects(
    actions.execute({ actionId: "notes.write", input: { text: "Hi", scope: "closed" }, context: API_CONTEXT }),
    { code: "SCOPE_CLOSED", message: "This scope is closed." }
  );
  assert.deepEqual(logged.map(({ outcome, errorCode }) => ({ outcome, errorCode })), [{ outcome: "failure", errorCode: "SCOPE_CLOSED" }]);
});

test("the action provider takes the application's policy from the optional runtime.actions.policy capability", async () => {
  const calls = { input: [], execute: [] };
  const { policy } = createScopedPolicy(calls);
  let actions;
  const policyProvider = defineProvider({
    id: "notes.action-policy",
    provides: { policy: "runtime.actions.policy" },
    setup: () => ({ policy })
  });
  const notesProvider = defineProvider({
    id: "notes.actions",
    requires: { actionCatalogue: "runtime.actions" },
    setup({ actionCatalogue }) {
      actions = actionCatalogue;
      actionCatalogue.register({ contributorId: "notes", domain: "notes", actions: [noteAction({ execute: (input) => input })] });
      return {};
    }
  });

  const withPolicy = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [notesProvider, ActionProvider, EventProvider, policyProvider]
  });
  await withPolicy.start();
  assert.deepEqual(
    await actions.execute({ actionId: "notes.write", input: { text: "Hi", scope: "home" }, context: API_CONTEXT }),
    { text: "Hi", author: "resolved-author" }
  );
  await withPolicy.shutdown();

  const withoutPolicy = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [notesProvider, ActionProvider, EventProvider]
  });
  await withoutPolicy.start();
  assert.deepEqual(
    await actions.execute({ actionId: "notes.write", input: { text: "Hi", author: "Ada" }, context: API_CONTEXT }),
    { text: "Hi", author: "Ada" }
  );
  await withoutPolicy.shutdown();
});
