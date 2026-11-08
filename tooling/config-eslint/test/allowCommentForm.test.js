import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import vueParser from "vue-eslint-parser";
import { jskitPlugin } from "../plugin/index.js";
import { allowCommentForm } from "../plugin/rules/allowCommentForm.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/allow-comment-form", allowCommentForm, {
  valid: [
    "// readable-check: allow method-probe - platform object: a fetch Response may lack getSetCookie()\nif (typeof headers.getSetCookie === \"function\") {}",
    "// readable-check: allow method-probe - safety invariant: without runtime.http's router no action route registers\nif (typeof http.router !== \"object\") {}",
    "// readable-check: allow setter-seam - cycle: workspaces.integrations requires auth.service\nauth.setInvitationContextResolver(resolver);",
    "// readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions\nattachAuthService(deferred, service);",
    "// readable-check: allow method-probe - filled by the editor repository; convert with its supplier\nstore.setProvider(provider);",
    "// readable-check: allow method-probe - cross-repository slot editor.session-preparation\nif (typeof preparation.run === \"function\") {}",
    "/* readable-check: allow method-probe - data: a route definition may omit its schema */\nif (typeof route.schema === \"object\") {}",
    "// readable-check: allow dependency-default - data: an absent list of providers has none\nfunction build({ providers = [] } = {}) { return providers; }",
    "// readable-check: allow method-probe - data: a route definition may omit its handler\nconst handler = typeof route.handler === \"function\" ? route.handler : null;",
    "const routes = []; // readable-check: allow no-dual-shape - data: a route list or one route\nfunction read() {}",
    "// The vocabulary: \"// readable-check: allow <rule> - <reason>\".\nconst x = 1;",
    "const source = \"// readable-check: allow method-probe - anything\";",
    "// readable-check: allow no-direct-knex - infrastructure: the migration runner keeps its own bookkeeping table\nimport { readFile } from \"node:fs/promises\";",
    "// readable-check: allow no-hand-scope - infrastructure: the operator's cutover import, which names each workspace it loads\nimport { readFile } from \"node:fs/promises\";",
    "#!/usr/bin/env node\n/* readable-check: allow jskit/no-transaction-reader - infrastructure: the transaction manager every handle runs on */\n// readable-check: allow no-direct-knex - infrastructure: the transaction manager every handle runs on\nexport const run = () => {};",
    "// eslint-disable-next-line no-control-regex -- strips control characters\nconst text = value.replace(/[\\x00-\\x1f]/gu, \"\");"
  ],
  invalid: [
    {
      code: "// readable-check: allow method-probe - test asserts error: createActionRouteScope refuses a value that is not runtime.http\nif (typeof http.router !== \"object\") {}",
      errors: [{ messageId: "retiredPrefix", line: 1 }]
    },
    {
      code: "// readable-check: allow required-collaborators - safety invariant: a test hands the service without a repository\nif (!repository) {}",
      errors: [{ messageId: "citesTests" }]
    },
    {
      code: "// readable-check: allow method-probe - optional operation: tests build the workflow without the invoices service\nif (typeof invoicesService.read === \"function\") {}",
      errors: [{ messageId: "citesTests", line: 1 }]
    },
    {
      code: "    // readable-check: allow optional-call - platform object: a test clock's timer may lack unref()\n    timer.unref?.();",
      errors: [{ messageId: "citesTests", line: 1, column: 8 }]
    },
    {
      code: "// readable-check: allow optional-call - platform object: a mocked interval may lack unref()\ninterval.unref?.();",
      errors: [{ messageId: "citesTests" }]
    },
    {
      code: "// readable-check: allow dependency-default - Tests hand the audits service without its capability\nconst audits = capability.service || capability;",
      errors: [{ messageId: "allowPrefix" }]
    },
    {
      code: "// readable-check: allow method-probe - data: package X stays unchanged\nif (typeof x.read === \"function\") {}",
      errors: [{ messageId: "citesStatus" }]
    },
    {
      code: "// readable-check: allow setter-seam - cycle: terminals requires database tools, kept for now\nruntime.setProvider(next);",
      errors: [{ messageId: "citesStatus" }]
    },
    {
      code: "// readable-check: allow method-probe - input validation: TODO remove once the store is split\nif (typeof store.read !== \"function\") {}",
      errors: [{ messageId: "citesStatus" }]
    },
    {
      code: "// readable-check: allow duplicate-helper - data: the same small text helper as the sibling module\nfunction toLabel(value) { return String(value); }",
      errors: [{ messageId: "dataOnFunction", line: 1 }]
    },
    {
      code: "// readable-check: allow duplicate-helper - data: a shared formatter\nexport const format = (value) => String(value);",
      errors: [{ messageId: "dataOnFunction" }]
    },
    {
      code: "const helpers = {\n  // readable-check: allow duplicate-helper - data: a lookup helper\n  find(id) { return id; }\n};",
      errors: [{ messageId: "dataOnFunction", line: 2 }]
    },
    {
      code: "// readable-check: allow method-probe: the router may be absent\nif (typeof router.register !== \"function\") {}",
      errors: [{ messageId: "allowForm" }]
    },
    {
      code: "// readable-check: allow method-probe - an application slot\nif (typeof router.register !== \"function\") {}",
      errors: [{ messageId: "allowPrefix", data: { reason: "an application slot" } }]
    },
    {
      code: "import { x } from \"y\";\n// readable-check: allow no-direct-knex - infrastructure: protocol state of the sign-in flow\nconst rows = x;",
      errors: [{ messageId: "infrastructureExcuse", line: 2 }]
    },
    {
      code: "// readable-check: allow method-probe - infrastructure: the connection pool\nif (typeof pool.end === \"function\") {}",
      errors: [{ messageId: "infrastructureExcuse" }]
    },
    {
      code: "// readable-check: allow no-transaction-reader - safety invariant: the caller always passes a transaction\nconst client = options.trx;",
      errors: [{ messageId: "infrastructureExcuse" }]
    },
    {
      code: "<template>\n  <!-- readable-check: allow no-direct-knex - infrastructure: protocol state -->\n  <div />\n</template>",
      filename: "Example.vue",
      languageOptions: { parser: vueParser },
      errors: [{ messageId: "infrastructureExcuse" }]
    },
    {
      code: "// readable-check: allow sql-literal - data: the report's column list\nquery.selectRaw(columns);\n// readable-check: allow jskit/no-hand-scope - infrastructure: protocol state\n// readable-check: allow knex-reason - safety invariant: a known report",
      errors: [
        // sql-literal takes the infrastructure exception, but not a data: reason.
        { messageId: "infrastructureExcuse", line: 1 },
        // no-hand-scope takes the infrastructure exception, but only in the file's first lines, before any code.
        { messageId: "infrastructureExcuse", line: 3 },
        { messageId: "dataAccessUnexcusable", data: { rule: "knex-reason" }, line: 4 }
      ]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure: kept for now\nconst a = 1;",
      errors: [{ messageId: "citesStatus" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure: the store a test double replaces\nconst a = 1;",
      errors: [{ messageId: "citesTests" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure:\nconst a = 1;",
      errors: [{ messageId: "allowPrefix", data: { reason: "infrastructure:" } }]
    }
  ]
});

// A directive naming a jskit rule needs the plugin loaded, or ESLint reports the rule as undefined.
new RuleTester({ plugins: { jskit: jskitPlugin } }).run("jskit/allow-comment-form", allowCommentForm, {
  valid: [],
  invalid: [
    {
      code: "// eslint-disable-next-line jskit/no-direct-knex -- a quick report\nknex(\"users\");\n/* eslint-disable no-console, jskit/sql-literal */\nconsole.log(1);",
      errors: [
        { messageId: "dataAccessDisabled", data: { rule: "jskit/no-direct-knex" }, line: 1 },
        { messageId: "dataAccessDisabled", data: { rule: "jskit/sql-literal" }, line: 3 }
      ]
    }
  ]
});
