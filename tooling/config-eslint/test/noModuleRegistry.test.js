import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noModuleRegistry } from "../plugin/rules/noModuleRegistry.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-module-registry", noModuleRegistry, {
  valid: [
    "function registerRoutes(router) { router.register(\"GET\", \"/\"); }",
    "const items = []; function addItem(item) { items.push(item); }",
    "function createRegistry() { const items = []; function registerItem(item) { items.push(item); } return registerItem; }",
    "const handlers = new Map(); function registerHandler(name, handler) { handlers?.set(name, handler); }",
    "const handlers = new Map();\n// readable-check: allow module-registry - the process-wide signal handlers\nfunction registerHandler(name, handler) { handlers.set(name, handler); }"
  ],
  invalid: [
    {
      code: "const handlers = new Map(); function registerHandler(name, handler) { handlers.set(name, handler); }",
      errors: [{ messageId: "moduleRegistry", data: { name: "registerHandler" } }]
    },
    {
      code: "let current = null; export function registerCurrent(next) { current = next; }",
      errors: [{ messageId: "moduleRegistry", data: { name: "registerCurrent" } }]
    },
    {
      code: "export const providers = []; function registerProvider(provider) { if (provider) { providers.unshift(provider); } }",
      errors: [{ messageId: "moduleRegistry", data: { name: "registerProvider" } }]
    }
  ]
});
