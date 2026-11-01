import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noOptionalAfterDefault } from "../plugin/rules/noOptionalAfterDefault.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-optional-after-default", noOptionalAfterDefault, {
  valid: [
    "async function getDocumentById(recordId, query = {}, options = {}) {\n  return repository.getDocumentById(recordId, query, { trx: options.trx || null, context: options.context || null });\n}",
    "function resolveStorage({ trx = null } = {}) { return trx?.commit(); }",
    "function readSettings(options) { return options?.context; }",
    "function readSettings(options = {}) { options = load(); return options?.context; }",
    "function readSettings(options = {}) { return (context) => context?.actor; }",
    "function bindStorage({ env = {}, rootDir = process.cwd() } = {}) { return { env: env.STORAGE, rootDir }; }",
    "function label(name = \"\") { return String(name || \"\"); }",
    "function readSettings(options = {}) {\n  // readable-check: allow optional-after-default - input validation: an application may pass null\n  return options?.context;\n}"
  ],
  invalid: [
    {
      code: "async function deletePet(recordId, options = {}) {\n  await repository.deleteDocumentById(recordId, { trx: options?.trx || null, context: options?.context || null });\n}",
      errors: [
        { messageId: "optionalAfterDefault", data: { name: "options", fallback: "{}", use: "options?." } },
        { messageId: "optionalAfterDefault", data: { name: "options", fallback: "{}", use: "options?." } }
      ]
    },
    {
      code: "function bindStorage({ env = {}, rootDir = process.cwd() } = {}) { return env?.STORAGE_DRIVER; }",
      errors: [{ messageId: "optionalAfterDefault", data: { name: "env", fallback: "{}", use: "env?." } }]
    },
    {
      code: "function updateSettings(input, options = {}) { const resolved = options || {}; return resolved.context; }",
      errors: [{ messageId: "defaultAfterDefault", data: { name: "options", fallback: "{}", use: "options || {}" } }]
    },
    {
      code: "const resolveSurfaces = (appConfig = {}) => isRecord(appConfig?.surfaceAccessPolicies);",
      errors: [{ messageId: "optionalAfterDefault" }]
    },
    {
      code: "function createWorkspaceRun({ metadata = {}, terminal = {} } = {}) {\n  if (!metadata?.accountId || !terminal?.id) return null;\n}",
      errors: [{ messageId: "optionalAfterDefault" }, { messageId: "optionalAfterDefault" }]
    },
    {
      code: "function notify({ onProgress = () => {} } = {}) { onProgress?.(1); }",
      errors: [{ messageId: "optionalAfterDefault", data: { name: "onProgress", fallback: "() => {}", use: "onProgress?." } }]
    },
    {
      code: "function listIds(ids = []) { return ids ?? []; }",
      errors: [{ messageId: "defaultAfterDefault" }]
    }
  ]
});
