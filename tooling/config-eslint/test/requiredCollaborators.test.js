import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { requiredCollaborators } from "../plugin/rules/requiredCollaborators.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/required-collaborators", requiredCollaborators, {
  valid: [
    "function createReader({ store }) { return () => store.read(); }",
    "function createClock({ now = Date.now, logger = console } = {}) { logger.info(now()); }",
    "function createFetcher({ fetchImpl = globalThis.fetch, store }) { return fetchImpl(store.url()); }",
    "function createLabel({ title = null } = {}) { return title; }",
    "if (typeof value === \"string\") {}",
    "if (typeof handler === \"function\") {}",
    "if (typeof options.limit === \"number\") {}",
    "store?.read();",
    "callback?.();",
    "// readable-check: allow method-probe - an application slot\nif (typeof router.register !== \"function\") {}",
    "// readable-check: allow required-collaborators - an application slot\nservice.read?.();"
  ],
  invalid: [
    {
      code: "function createReader({ store } = {}) { return () => store.read(); }",
      errors: [{ messageId: "dependenciesDefault", data: { name: "createReader", fallback: "{}" } }]
    },
    {
      code: "function createReader({ store = null, label = \"\" }) { return () => store.read(label); }",
      errors: [{ messageId: "collaboratorDefault", data: { name: "store", fallback: "null" } }]
    },
    {
      code: "function createReader({ store, onRead = () => {} }) { return () => onRead(store.read()); }",
      errors: [{ messageId: "collaboratorDefault", data: { name: "onRead", fallback: "() => {}" } }]
    },
    {
      code: "function createReader({ store, onRead = async () => null }) { return () => store.read(); }",
      errors: [{ messageId: "collaboratorDefault", data: { name: "onRead", fallback: "async () => null" } }]
    },
    {
      code: "if (typeof router.register !== \"function\") { throw new TypeError(\"router required\"); }",
      errors: [{ messageId: "methodProbe", data: { probe: "router.register" } }]
    },
    {
      code: "const ready = \"function\" === typeof dependencies.service?.read;",
      errors: [{ messageId: "methodProbe", data: { probe: "dependencies.service?.read" } }]
    },
    {
      code: "service.read?.();",
      errors: [{ messageId: "optionalCall", data: { callee: "service.read" } }]
    },
    {
      code: "dependencies?.service?.read?.(input);",
      errors: [{ messageId: "optionalCall", data: { callee: "dependencies?.service?.read" } }]
    }
  ]
});
