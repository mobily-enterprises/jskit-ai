import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noEnvDefault } from "../plugin/rules/noEnvDefault.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-env-default", noEnvDefault, {
  valid: [
    "/** @param {{ env: RuntimeEnv }} options */\nfunction createMailer({ env }) { return env.SMTP_HOST; }",
    "const config = createKnexMigrationConfig({ environment: process.env });",
    "const port = process.env.PORT || \"3000\";",
    "function resolve(env) { return env || {}; }"
  ],
  invalid: [
    {
      code: "function createMailer({ env = process.env } = {}) { return env.SMTP_HOST; }",
      errors: [{ messageId: "envDefault", data: { name: "env" } }]
    },
    {
      code: "function readKey(name, env = process.env) { return env[name]; }",
      errors: [{ messageId: "envDefault", data: { name: "env" } }]
    },
    {
      code: "function readKey(name, env) { const source = env ?? process.env; return source[name]; }",
      errors: [{ messageId: "envDefault", data: { name: "env" } }]
    },
    {
      code: "function readKey(options) { return (options.env || process.env).KEY; }",
      errors: [{ messageId: "envDefault", data: { name: "options.env" } }]
    }
  ]
});
