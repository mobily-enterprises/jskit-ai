import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { typedDependencies } from "../plugin/rules/typedDependencies.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/typed-dependencies", typedDependencies, {
  valid: [
    "/** @param {{ bookingService: BookingService }} dependencies */\nfunction createBookingActions({ bookingService }) { return () => bookingService.read(); }",
    "/**\n * @param {object} dependencies\n * @param {Store} dependencies.store\n */\nexport const createReader = ({ store }) => store.read();",
    "class Engine {\n  /** @param {{ runtime: Runtime }} dependencies */\n  constructor({ runtime }) { runtime.start(); }\n}",
    "function createLabel({ name, title }) { return `${title} ${name}`; }",
    "function startEngine({ runtime }) { runtime.start(); }",
    "function createReader(store) { return () => store.read(); }",
    "// readable-check: allow untyped-dependencies - typed by its generated caller\nfunction createReader({ store }) { return () => store.read(); }",
    "// readable-check: allow typed-dependencies - typed by its generated caller\nfunction createReader({ store }) { return () => store.read(); }",
    "/** @param {{ store: Store }} dependencies */\nfunction createReader(dependencies) {\n  const { store } = dependencies;\n  return () => store.read();\n}",
    "function createLabel(options) {\n  const { name, title } = options;\n  return `${title} ${name}`;\n}",
    "function createReader(dependencies) {\n  const { store } = other;\n  return () => store.read();\n}"
  ],
  invalid: [
    {
      code: "function createReader({ store, label }) { return () => store.read(label); }",
      errors: [{ messageId: "untypedDependencies", data: { name: "createReader", collaborators: "store" }, line: 1 }]
    },
    {
      code: "export const buildActions = ({ accountService, clock }) => createActionList({ accountService });",
      errors: [{ messageId: "untypedDependencies", data: { name: "buildActions", collaborators: "accountService" } }]
    },
    {
      code: "function createFeature({ settingsRepository }) { return createService(settingsRepository); }",
      errors: [{ messageId: "untypedDependencies", data: { name: "createFeature", collaborators: "settingsRepository" } }]
    },
    {
      code: "class Engine {\n  constructor({ runtime }) { runtime.start(); }\n}",
      errors: [{ messageId: "untypedDependencies", data: { name: "constructor", collaborators: "runtime" }, line: 2 }]
    },
    {
      code: "const factories = {\n  createThing({ store, publish }) { publish(store.read()); }\n};",
      errors: [{ messageId: "untypedDependencies", data: { name: "createThing", collaborators: "publish, store" }, line: 2 }]
    },
    {
      code: "function createReader(dependencies) {\n  const { store, label } = dependencies;\n  return () => store.read(label);\n}",
      errors: [{ messageId: "untypedDependencies", data: { name: "createReader", collaborators: "store" }, line: 1 }]
    },
    {
      code: "export const createWriter = (deps = {}) => {\n  const { clock } = deps;\n  const { store } = deps;\n  return () => store.write(clock());\n};",
      errors: [{ messageId: "untypedDependencies", data: { name: "createWriter", collaborators: "store, clock" } }]
    }
  ]
});
