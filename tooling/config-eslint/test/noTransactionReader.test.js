import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noTransactionReader } from "../plugin/rules/noTransactionReader.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const EXCUSE = "// readable-check: allow no-transaction-reader - infrastructure: the transaction manager every handle runs on";

new RuleTester().run("jskit/no-transaction-reader", noTransactionReader, {
  valid: [
    "function save(row, options) { return records.create(row, options); }",
    "function settle(input, options) { return lots.withTransaction(options, (tx) => lots.patch(input.id, input.changes, tx)); }",
    "const next = { ...options, lockVersion: 2 };",
    // Settings ride in the options the call received, spread with the setting.
    "function once(options, work) { return lots.withTransaction({ ...options, retry: false }, work); }",
    "function takeOne(options) { return queue.claim({ filters: { due: true }, take: 1 }, { ...options, missing: \"skip\" }); }",
    "const { context } = options;",
    "const reference = payment.transaction.id;",
    "function begin(trx) { return trx; }",
    `${EXCUSE}\nexport function joinOrOpen(options, work) { return options.trx ? work(options.trx) : open(work); }`,
    "/* readable-check: allow jskit/no-transaction-reader - infrastructure: the transaction manager */\nexport const client = ({ trx } = {}) => trx;"
  ],
  invalid: [
    {
      code: "const client = options.trx || knex;",
      errors: [{ messageId: "handRead", data: { text: "options.trx" } }]
    },
    {
      code: "const client = options?.trx ?? knex;\nif (callOptions.trx) {}",
      errors: [{ messageId: "handRead", line: 1 }, { messageId: "handRead", line: 2 }]
    },
    {
      code: "await repository.list(query, { trx: options.trx });",
      errors: [{ messageId: "handRead", data: { text: "options.trx" } }]
    },
    {
      code: "await lots.withTransaction({ context: options.context, trx: options.trx, retry: false }, work);",
      errors: [{ messageId: "handRead", data: { text: "options.trx" } }]
    },
    {
      code: "function save(row, { trx, context }) { return [row, trx, context]; }",
      errors: [{ messageId: "handRead", data: { text: "Destructuring trx" } }]
    },
    {
      code: "const { trx = null } = options;\nconst { trx: transaction } = callOptions;",
      errors: [{ messageId: "handRead", line: 1 }, { messageId: "handRead", line: 2 }]
    },
    {
      code: "function save(row, trx = knex) { return trx(\"rows\").insert(row); }",
      errors: [{ messageId: "knexDefault", data: { text: "trx = knex" } }]
    },
    {
      code: "function save(row, trx = this.knex) { return row; }",
      errors: [{ messageId: "knexDefault", data: { text: "trx = this.knex" } }]
    },
    {
      code: "const transaction = options.transaction;\nawait api.query({ transaction: queryOptions.transaction }, context);\nconst t = opts.transaction;",
      errors: [{ messageId: "handRead", line: 1 }, { messageId: "handRead", line: 2 }, { messageId: "handRead", line: 3 }]
    },
    {
      code: "// readable-check: allow no-transaction-reader - infrastructure: not yet converted to handles\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    },
    {
      code: "const a = 1;\n// readable-check: allow no-transaction-reader - infrastructure: the transaction manager\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure: the transaction manager\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    },
    {
      code: "// readable-check: allow no-transaction-reader - data: a transaction handle\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    }
  ]
});
